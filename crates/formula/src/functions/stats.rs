//! Counting and averaging.
//!
//! The difference between `COUNT` and `COUNTA` is the whole of what people get
//! wrong about spreadsheets: one counts numbers and the other counts anything
//! at all, and a column of part numbers counted with the first comes to
//! nought. Both are here and neither is the default.

use super::{done, flattened, numbers, Function};
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

function!(AVERAGE, "AVERAGE", 1, None, |arguments, context| {
    done((|| {
        let found = numbers(&flattened(arguments, context), false)?;
        if found.is_empty() {
            // Nothing to average is not nought: it is the error that says the
            // question had no answer.
            return Ok(Value::Error(Error::DivideByZero));
        }

        Ok(Value::Number(
            found.iter().sum::<f64>() / found.len() as f64,
        ))
    })())
});

function!(COUNT, "COUNT", 1, None, |arguments, context| {
    // Numbers only, errors included as not-numbers: `COUNT` never fails, which
    // is what makes it usable over a column somebody is still filling in.
    let found = flattened(arguments, context);
    let how_many = found
        .iter()
        .filter(|value| matches!(value, Value::Number(_)))
        .count();

    Value::Number(how_many as f64)
});

function!(COUNTA, "COUNTA", 1, None, |arguments, context| {
    let found = flattened(arguments, context);
    let how_many = found
        .iter()
        .filter(|value| !matches!(value, Value::Blank))
        .count();

    Value::Number(how_many as f64)
});

function!(
    COUNTBLANK,
    "COUNTBLANK",
    1,
    Some(1),
    |arguments, context| {
        let found = flattened(arguments, context);
        // A cell holding "" counts as blank here, which is the one place Excel
        // treats the empty string as emptiness.
        let how_many = found
            .iter()
            .filter(|value| {
                matches!(value, Value::Blank)
                    || matches!(value, Value::Text(text) if text.is_empty())
            })
            .count();

        Value::Number(how_many as f64)
    }
);

function!(MIN, "MIN", 1, None, |arguments, context| {
    done((|| {
        let found = numbers(&flattened(arguments, context), false)?;
        // No numbers is nought, as Excel has it — not an error, and not the
        // largest number there is.
        Ok(Value::Number(
            found
                .iter()
                .copied()
                .fold(f64::INFINITY, f64::min)
                .min(f64::INFINITY),
        ))
    })())
    .clamp_empty()
});

function!(MAX, "MAX", 1, None, |arguments, context| {
    done((|| {
        let found = numbers(&flattened(arguments, context), false)?;
        Ok(Value::Number(
            found.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        ))
    })())
    .clamp_empty()
});

function!(MEDIAN, "MEDIAN", 1, None, |arguments, context| {
    done((|| {
        let mut found = numbers(&flattened(arguments, context), false)?;
        if found.is_empty() {
            return Ok(Value::Error(Error::Number));
        }

        found.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let middle = found.len() / 2;

        Ok(Value::Number(if found.len() % 2 == 0 {
            (found[middle - 1] + found[middle]) / 2.0
        } else {
            found[middle]
        }))
    })())
});

/// An empty `MIN` or `MAX` is nought, which is easier to say here than inline.
trait ClampEmpty {
    fn clamp_empty(self) -> Value;
}

impl ClampEmpty for Value {
    fn clamp_empty(self) -> Value {
        match self {
            Value::Number(value) if value.is_infinite() => Value::Number(0.0),
            other => other,
        }
    }
}
