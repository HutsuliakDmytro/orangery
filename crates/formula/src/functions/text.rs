//! Words.
//!
//! Two things here are counted from one rather than from nought — `MID` and
//! `FIND` — because that is how a spreadsheet counts, and a text function that
//! was out by one would be wrong in every cell it touched.

use super::{done, number, string, values, Function};
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

/// The letters of a value, as a reader counts them.
///
/// Not bytes and not code points: `ї` can be written as two code points and is
/// one letter, so `LEN` over a Ukrainian word has to agree with the person
/// looking at it.
fn letters(text: &str) -> Vec<char> {
    text.chars().collect()
}

function!(LEN, "LEN", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| Value::Number(letters(&text).len() as f64)))
});

function!(LEFT, "LEFT", 1, Some(2), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let how_many = match arguments.get(1) {
            None => 1.0,
            Some(_) => number(arguments.get(1), context)?,
        };

        if how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        let taken: String = letters(&text).into_iter().take(how_many as usize).collect();
        Ok(Value::Text(taken))
    })())
});

function!(RIGHT, "RIGHT", 1, Some(2), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let how_many = match arguments.get(1) {
            None => 1.0,
            Some(_) => number(arguments.get(1), context)?,
        };

        if how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        let all = letters(&text);
        let from = all.len().saturating_sub(how_many as usize);
        Ok(Value::Text(all[from..].iter().collect()))
    })())
});

function!(MID, "MID", 3, Some(3), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let from = number(arguments.get(1), context)?;
        let how_many = number(arguments.get(2), context)?;

        // Counted from one, and nought is not a place in a string.
        if from < 1.0 || how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        let all = letters(&text);
        let start = (from as usize) - 1;
        if start >= all.len() {
            return Ok(Value::Text(String::new()));
        }

        let end = (start + how_many as usize).min(all.len());
        Ok(Value::Text(all[start..end].iter().collect()))
    })())
});

function!(UPPER, "UPPER", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| Value::Text(text.to_uppercase())))
});

function!(LOWER, "LOWER", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| Value::Text(text.to_lowercase())))
});

function!(TRIM, "TRIM", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| {
        // Excel's `TRIM` also squeezes the spaces inside: it exists for text
        // that came out of a system that padded its columns.
        let squeezed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        Value::Text(squeezed)
    }))
});

function!(CONCAT, "CONCAT", 1, None, |arguments, context| {
    done(joined(arguments, context, "", false))
});

function!(CONCATENATE, "CONCATENATE", 1, None, |arguments, context| {
    done(joined(arguments, context, "", false))
});

function!(TEXTJOIN, "TEXTJOIN", 3, None, |arguments, context| {
    done((|| {
        let separator = string(arguments.first(), context)?;
        let skip_blanks = crate::eval::evaluate(&arguments[1], context).to_bool()?;

        joined(&arguments[2..], context, &separator, skip_blanks)
    })())
});

function!(EXACT, "EXACT", 2, Some(2), |arguments, context| {
    done((|| {
        let first = string(arguments.first(), context)?;
        let second = string(arguments.get(1), context)?;

        // The one text comparison in a spreadsheet that does mind the case,
        // which is the whole reason it exists.
        Ok(Value::Bool(first == second))
    })())
});

function!(FIND, "FIND", 2, Some(3), |arguments, context| {
    done(found(arguments, context, true))
});

function!(SEARCH, "SEARCH", 2, Some(3), |arguments, context| {
    // The same thing without the case, which is the difference people forget.
    done(found(arguments, context, false))
});

function!(
    SUBSTITUTE,
    "SUBSTITUTE",
    3,
    Some(4),
    |arguments, context| {
        done((|| {
            let text = string(arguments.first(), context)?;
            let from = string(arguments.get(1), context)?;
            let to = string(arguments.get(2), context)?;

            if from.is_empty() {
                return Ok(Value::Text(text));
            }

            let which = match arguments.get(3) {
                None => None,
                Some(_) => Some(number(arguments.get(3), context)? as usize),
            };

            match which {
                None => Ok(Value::Text(text.replace(&from, &to))),
                Some(0) => Ok(Value::Error(Error::Value)),
                Some(nth) => {
                    // Only the nth one, counted from the left, which is what the
                    // fourth argument is for.
                    let mut result = String::new();
                    let mut rest = text.as_str();
                    let mut seen = 0usize;

                    while let Some(at) = rest.find(&from) {
                        seen += 1;
                        result.push_str(&rest[..at]);

                        if seen == nth {
                            result.push_str(&to);
                        } else {
                            result.push_str(&from);
                        }

                        rest = &rest[at + from.len()..];
                    }

                    result.push_str(rest);
                    Ok(Value::Text(result))
                }
            }
        })())
    }
);

function!(REPT, "REPT", 2, Some(2), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let times = number(arguments.get(1), context)?;

        if times < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        Ok(Value::Text(text.repeat(times as usize)))
    })())
});

/// `CONCAT`, `CONCATENATE` and `TEXTJOIN`, which differ in what goes between.
fn joined(
    arguments: &[crate::ast::Expr],
    context: &crate::eval::Context<'_>,
    separator: &str,
    skip_blanks: bool,
) -> Result<Value, Error> {
    let mut pieces: Vec<String> = Vec::new();

    for value in values(arguments, context) {
        match value {
            Value::Array(array) => {
                for inside in array.values {
                    if skip_blanks && matches!(inside, Value::Blank) {
                        continue;
                    }
                    pieces.push(inside.to_text()?);
                }
            }
            Value::Blank if skip_blanks => {}
            other => pieces.push(other.to_text()?),
        }
    }

    Ok(Value::Text(pieces.join(separator)))
}

/// `FIND` and `SEARCH`: where one string sits inside another, counted from one.
fn found(
    arguments: &[crate::ast::Expr],
    context: &crate::eval::Context<'_>,
    case_matters: bool,
) -> Result<Value, Error> {
    let needle = string(arguments.first(), context)?;
    let haystack = string(arguments.get(1), context)?;

    let from = match arguments.get(2) {
        None => 1.0,
        Some(_) => number(arguments.get(2), context)?,
    };

    if from < 1.0 {
        return Ok(Value::Error(Error::Value));
    }

    let all = letters(&haystack);
    let start = (from as usize) - 1;
    if start > all.len() {
        return Ok(Value::Error(Error::Value));
    }

    let rest: String = all[start..].iter().collect();
    let (rest, needle) = if case_matters {
        (rest, needle)
    } else {
        (rest.to_lowercase(), needle.to_lowercase())
    };

    match rest.find(&needle) {
        // Counted in letters rather than in bytes, and from one.
        Some(at) => {
            let letters_before = rest[..at].chars().count();
            Ok(Value::Number((start + letters_before + 1) as f64))
        }
        // Not there at all is `#VALUE!`, which is what `IFERROR` is usually
        // wrapped around.
        None => Ok(Value::Error(Error::Value)),
    }
}
