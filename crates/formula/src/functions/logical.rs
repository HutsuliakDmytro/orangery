//! The questions: `IF` and the words around it.
//!
//! These are the functions that must not work out what they are not asked
//! about. `IF(A1=0,0,1/A1)` divides by nought in any language that evaluates
//! both branches, and a spreadsheet that did would be wrong about the one
//! thing the formula was written to guard against. So they take their
//! arguments as trees and work out only the branch they take.

use super::{done, values, Function};
use crate::ast::Expr;
use crate::eval::{evaluate, Context};
use crate::value::{Error, Value};

macro_rules! function {
    ($constant:ident, $name:literal, $least:expr, $most:expr, $body:expr) => {
        pub static $constant: Function = Function {
            name: $name,
            min_arguments: $least,
            max_arguments: $most,
            volatile: false,
            call: $body,
        };
    };
}

function!(IF, "IF", 2, Some(3), |arguments, context| {
    let question = evaluate(&arguments[0], context);
    let answer = match question.to_bool() {
        Ok(answer) => answer,
        Err(error) => return Value::Error(error),
    };

    let taken = if answer {
        arguments.get(1)
    } else {
        arguments.get(2)
    };

    match taken {
        // `IF(A1,1)` with a false condition is FALSE, which is Excel's answer
        // and not the blank people expect.
        None => Value::Bool(false),
        Some(Expr::Blank) => Value::Number(0.0),
        Some(branch) => evaluate(branch, context),
    }
});

function!(IFS, "IFS", 2, None, |arguments, context| {
    for pair in arguments.chunks(2) {
        let Some(question) = pair.first() else {
            continue;
        };

        match evaluate(question, context).to_bool() {
            Err(error) => return Value::Error(error),
            Ok(false) => continue,
            Ok(true) => {
                return match pair.get(1) {
                    Some(answer) => evaluate(answer, context),
                    // A condition with nothing after it is a formula somebody
                    // is still typing.
                    None => Value::Error(Error::Value),
                };
            }
        }
    }

    // Nothing matched, which `IFS` says with the error for "no answer".
    Value::Error(Error::NotAvailable)
});

function!(AND, "AND", 1, None, |arguments, context| {
    done(fold(arguments, context, true))
});

function!(OR, "OR", 1, None, |arguments, context| {
    done(fold(arguments, context, false))
});

function!(XOR, "XOR", 1, None, |arguments, context| {
    done((|| {
        let mut trues = 0usize;

        for value in flattened_bools(arguments, context)? {
            if value {
                trues += 1;
            }
        }

        Ok(Value::Bool(trues % 2 == 1))
    })())
});

function!(NOT, "NOT", 1, Some(1), |arguments, context| {
    done(
        evaluate(&arguments[0], context)
            .to_bool()
            .map(|value| Value::Bool(!value)),
    )
});

function!(IFERROR, "IFERROR", 2, Some(2), |arguments, context| {
    let value = evaluate(&arguments[0], context);
    if value.is_error() {
        return evaluate(&arguments[1], context);
    }
    value
});

function!(IFNA, "IFNA", 2, Some(2), |arguments, context| {
    let value = evaluate(&arguments[0], context);
    // Only `#N/A`: a lookup that found nothing is a different thing from a
    // formula that is broken, and catching both would hide the second.
    if value == Value::Error(Error::NotAvailable) {
        return evaluate(&arguments[1], context);
    }
    value
});

function!(
    TRUE,
    "TRUE",
    0,
    Some(0),
    |_arguments, _context| Value::Bool(true)
);
function!(FALSE, "FALSE", 0, Some(0), |_arguments, _context| {
    Value::Bool(false)
});

/// `AND` and `OR`, which differ only in what stops them.
fn fold(arguments: &[Expr], context: &Context<'_>, all: bool) -> Result<Value, Error> {
    let mut seen = false;
    let mut result = all;

    for value in flattened_bools(arguments, context)? {
        seen = true;
        result = if all {
            result && value
        } else {
            result || value
        };
    }

    // Nothing to judge is `#VALUE!`: a range of blanks is not an answer.
    if !seen {
        return Err(Error::Value);
    }

    Ok(Value::Bool(result))
}

/// Every value these are given, as questions rather than as numbers.
///
/// Blanks and text inside a range are skipped rather than failing — a column
/// of TRUE and FALSE with a heading is what people actually pass — but text
/// written straight into the formula is an error, because it was meant.
fn flattened_bools(arguments: &[Expr], context: &Context<'_>) -> Result<Vec<bool>, Error> {
    let mut found = Vec::new();

    for value in values(arguments, context) {
        match value {
            Value::Array(array) => {
                for inside in array.values {
                    match inside {
                        Value::Bool(flag) => found.push(flag),
                        Value::Number(number) => found.push(number != 0.0),
                        Value::Error(error) => return Err(error),
                        _ => {}
                    }
                }
            }
            Value::Blank => {}
            other => found.push(other.to_bool()?),
        }
    }

    Ok(found)
}
