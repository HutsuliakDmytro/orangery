//! Questions about a value rather than about what it is worth.
//!
//! These are what people wrap around a formula that might not work.
//! `ISBLANK` is the one worth being careful about: a cell holding "" is not
//! blank, and a formula that returns "" has not left the cell empty — which
//! is why a column filtered on `ISBLANK` and a column filtered on `=""` give
//! different answers, and both are right.

use super::{done, Function};
use crate::eval::evaluate;
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

function!(ISBLANK, "ISBLANK", 1, Some(1), |arguments, context| {
    Value::Bool(matches!(evaluate(&arguments[0], context), Value::Blank))
});

function!(ISNUMBER, "ISNUMBER", 1, Some(1), |arguments, context| {
    Value::Bool(matches!(evaluate(&arguments[0], context), Value::Number(_)))
});

function!(ISTEXT, "ISTEXT", 1, Some(1), |arguments, context| {
    Value::Bool(matches!(evaluate(&arguments[0], context), Value::Text(_)))
});

function!(ISLOGICAL, "ISLOGICAL", 1, Some(1), |arguments, context| {
    Value::Bool(matches!(evaluate(&arguments[0], context), Value::Bool(_)))
});

function!(ISERROR, "ISERROR", 1, Some(1), |arguments, context| {
    Value::Bool(evaluate(&arguments[0], context).is_error())
});

function!(ISERR, "ISERR", 1, Some(1), |arguments, context| {
    // Every error but the one that means "not found", which is the
    // distinction that makes a lookup's failure different from a broken sum.
    Value::Bool(match evaluate(&arguments[0], context) {
        Value::Error(Error::NotAvailable) => false,
        other => other.is_error(),
    })
});

function!(ISNA, "ISNA", 1, Some(1), |arguments, context| {
    Value::Bool(evaluate(&arguments[0], context) == Value::Error(Error::NotAvailable))
});

function!(NA, "NA", 0, Some(0), |_arguments, _context| {
    Value::Error(Error::NotAvailable)
});

function!(N, "N", 1, Some(1), |arguments, context| {
    let value = evaluate(&arguments[0], context);

    // Text is nought rather than an error here, which is the whole point of
    // `N`: it is the polite way to ask for a number.
    Value::Number(match value {
        Value::Number(number) => number,
        Value::Bool(flag) => {
            if flag {
                1.0
            } else {
                0.0
            }
        }
        Value::Error(error) => return Value::Error(error),
        _ => 0.0,
    })
});

function!(T, "T", 1, Some(1), |arguments, context| {
    match evaluate(&arguments[0], context) {
        Value::Text(text) => Value::Text(text),
        Value::Error(error) => Value::Error(error),
        // Anything that is not text is "", which is `T`'s answer to a number.
        _ => Value::Text(String::new()),
    }
});

function!(TYPE, "TYPE", 1, Some(1), |arguments, context| {
    // Excel's numbering, which has gaps in it because the list grew.
    done(Ok(Value::Number(match evaluate(&arguments[0], context) {
        Value::Number(_) | Value::Blank => 1.0,
        Value::Text(_) => 2.0,
        Value::Bool(_) => 4.0,
        Value::Error(_) => 16.0,
        Value::Array(_) => 64.0,
    })))
});
