//! Arithmetic, as a spreadsheet does it.
//!
//! The rounding is the part worth being careful about. `ROUND` is half away
//! from zero, not the banker's rounding a language's own library does, so
//! `ROUND(2.5,0)` is 3 here and 2 in Rust — and a column of invoices rounded
//! the wrong way is a column that disagrees with the invoice.

use super::{done, flattened, number, numbers, Function};
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

function!(SUM, "SUM", 1, None, |arguments, context| {
    done((|| {
        // Text inside a range is skipped and text written into the formula is
        // read as a number: Excel's rule, and the reason `SUM(A1:A9)` over a
        // column with a heading is the total rather than `#VALUE!`.
        let found = numbers(&flattened(arguments, context), false)?;
        Ok(Value::Number(found.iter().sum()))
    })())
});

function!(PRODUCT, "PRODUCT", 1, None, |arguments, context| {
    done((|| {
        let found = numbers(&flattened(arguments, context), false)?;
        Ok(Value::Number(found.iter().product()))
    })())
});

function!(ABS, "ABS", 1, Some(1), |arguments, context| {
    done(number(arguments.first(), context).map(|value| Value::Number(value.abs())))
});

function!(SIGN, "SIGN", 1, Some(1), |arguments, context| {
    done(number(arguments.first(), context).map(|value| {
        Value::Number(if value > 0.0 {
            1.0
        } else if value < 0.0 {
            -1.0
        } else {
            0.0
        })
    }))
});

function!(INT, "INT", 1, Some(1), |arguments, context| {
    // Downwards, always: `INT(-2.5)` is -3, which is not what truncation does.
    done(number(arguments.first(), context).map(|value| Value::Number(value.floor())))
});

function!(TRUNC, "TRUNC", 1, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let digits = number(arguments.get(1), context)?;
        let factor = 10_f64.powi(digits as i32);

        Ok(Value::Number((value * factor).trunc() / factor))
    })())
});

function!(ROUND, "ROUND", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let digits = number(arguments.get(1), context)?;

        Ok(Value::Number(rounded(value, digits, Rounding::Nearest)))
    })())
});

function!(ROUNDUP, "ROUNDUP", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let digits = number(arguments.get(1), context)?;

        Ok(Value::Number(rounded(value, digits, Rounding::Away)))
    })())
});

function!(ROUNDDOWN, "ROUNDDOWN", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let digits = number(arguments.get(1), context)?;

        Ok(Value::Number(rounded(value, digits, Rounding::Towards)))
    })())
});

function!(MOD, "MOD", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let divisor = number(arguments.get(1), context)?;

        if divisor == 0.0 {
            return Ok(Value::Error(Error::DivideByZero));
        }

        // The sign follows the divisor, as it does in Excel: `MOD(-3,2)` is 1,
        // not -1, which is the opposite of what the language's own operator
        // gives.
        Ok(Value::Number(value - divisor * (value / divisor).floor()))
    })())
});

function!(SQRT, "SQRT", 1, Some(1), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        if value < 0.0 {
            return Ok(Value::Error(Error::Number));
        }
        Ok(Value::Number(value.sqrt()))
    })())
});

function!(POWER, "POWER", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let exponent = number(arguments.get(1), context)?;
        let result = value.powf(exponent);

        if result.is_nan() || result.is_infinite() {
            return Ok(Value::Error(Error::Number));
        }
        Ok(Value::Number(result))
    })())
});

function!(EXP, "EXP", 1, Some(1), |arguments, context| {
    done(number(arguments.first(), context).map(|value| Value::Number(value.exp())))
});

function!(LN, "LN", 1, Some(1), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        if value <= 0.0 {
            return Ok(Value::Error(Error::Number));
        }
        Ok(Value::Number(value.ln()))
    })())
});

function!(LOG10, "LOG10", 1, Some(1), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        if value <= 0.0 {
            return Ok(Value::Error(Error::Number));
        }
        Ok(Value::Number(value.log10()))
    })())
});

function!(LOG, "LOG", 1, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let base = match arguments.get(1) {
            None => 10.0,
            Some(_) => number(arguments.get(1), context)?,
        };

        if value <= 0.0 || base <= 0.0 || base == 1.0 {
            return Ok(Value::Error(Error::Number));
        }
        Ok(Value::Number(value.log(base)))
    })())
});

function!(PI, "PI", 0, Some(0), |_arguments, _context| {
    Value::Number(std::f64::consts::PI)
});

enum Rounding {
    Nearest,
    Away,
    Towards,
}

/// Rounding the way a spreadsheet rounds.
///
/// Half away from zero rather than to the nearest even, because that is what
/// everybody was taught and what every invoice assumes: `ROUND(2.5,0)` is 3
/// and `ROUND(-2.5,0)` is -3.
fn rounded(value: f64, digits: f64, how: Rounding) -> f64 {
    let factor = 10_f64.powi(digits as i32);

    // Snapped to the fifteen significant digits a spreadsheet keeps before the
    // rounding, not after. `1.005` is 1.00499999999999989 in binary, and a
    // rounding done on that gives 1.00 where Excel gives 1.01 — the difference
    // between agreeing with the invoice and not.
    let scaled = crate::value::round_to_significant(value * factor, 15);

    let result = match how {
        Rounding::Nearest => {
            // `f64::round` is already half away from zero, which is the one
            // place the language agrees with the spreadsheet.
            scaled.round()
        }
        Rounding::Away => {
            if scaled < 0.0 {
                scaled.floor()
            } else {
                scaled.ceil()
            }
        }
        Rounding::Towards => scaled.trunc(),
    };

    result / factor
}
