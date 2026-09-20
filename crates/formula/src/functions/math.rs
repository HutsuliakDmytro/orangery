//! Arithmetic, as a spreadsheet does it.
//!
//! The rounding is the part worth being careful about. `ROUND` is half away
//! from zero, not the banker's rounding a language's own library does, so
//! `ROUND(2.5,0)` is 3 here and 2 in Rust — and a column of invoices rounded
//! the wrong way is a column that disagrees with the invoice.

use super::criteria::{all_matching, pairs};
use super::{done, flattened, number, numbers, table, Function};
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

function!(CEILING, "CEILING", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let step = number(arguments.get(1), context)?;

        // A step of nothing rounds to nothing, which is Excel's answer and
        // not the one `FLOOR` gives to the same question.
        if step == 0.0 {
            return Ok(Value::Number(0.0));
        }
        if value > 0.0 && step < 0.0 {
            return Ok(Value::Error(Error::Number));
        }

        Ok(Value::Number((value / step).ceil() * step))
    })())
});

function!(FLOOR, "FLOOR", 2, Some(2), |arguments, context| {
    done((|| {
        let value = number(arguments.first(), context)?;
        let step = number(arguments.get(1), context)?;

        // And here a step of nothing is a division by it. The pair have
        // disagreed about this since 1993; a reader that tidied it up would
        // disagree with the sheet.
        if step == 0.0 {
            return Ok(Value::Error(Error::DivideByZero));
        }
        if value > 0.0 && step < 0.0 {
            return Ok(Value::Error(Error::Number));
        }

        Ok(Value::Number((value / step).floor() * step))
    })())
});

function!(SUMSQ, "SUMSQ", 1, None, |arguments, context| {
    done((|| {
        let found = numbers(&flattened(arguments, context), false)?;
        Ok(Value::Number(found.iter().map(|value| value * value).sum()))
    })())
});

function!(SUMPRODUCT, "SUMPRODUCT", 1, None, |arguments, context| {
    done((|| {
        let mut columns: Vec<Vec<f64>> = Vec::new();

        for argument in arguments {
            let grid = table(Some(argument), context)?;
            // Anything that is not a number counts as nought rather than
            // stopping the total: a column of prices with a heading over it
            // is the ordinary case, not a mistake.
            columns.push(
                grid.values
                    .iter()
                    .map(|value| match value {
                        Value::Number(number) => *number,
                        _ => 0.0,
                    })
                    .collect(),
            );
        }

        let size = columns.first().map_or(0, Vec::len);
        if columns.iter().any(|column| column.len() != size) {
            // Lined up by position, so ranges of different shapes have no
            // answer rather than a short one.
            return Ok(Value::Error(Error::Value));
        }

        let mut total = 0.0;
        for index in 0..size {
            total += columns.iter().map(|column| column[index]).product::<f64>();
        }

        Ok(Value::Number(total))
    })())
});

function!(SUMIFS, "SUMIFS", 3, None, |arguments, context| {
    done((|| {
        // The range to add comes first here and last in `SUMIF`. Excel has
        // both orders and this is not the place to improve on it.
        let added = table(arguments.first(), context)?;
        let tests = pairs(arguments, 1, context)?;

        if tests
            .first()
            .is_some_and(|(range, _)| range.values.len() != added.values.len())
        {
            return Ok(Value::Error(Error::Value));
        }

        let mut total = 0.0;
        for index in all_matching(&tests)? {
            if let Some(Value::Number(number)) = added.values.get(index) {
                total += number;
            }
        }

        Ok(Value::Number(total))
    })())
});

/// The two that make up a different answer every time they are asked.
pub static RAND: Function = Function {
    name: "RAND",
    min_arguments: 0,
    max_arguments: Some(0),
    volatile: true,
    call: |_arguments, context| Value::Number(context.cells.random()),
};

pub static RANDBETWEEN: Function = Function {
    name: "RANDBETWEEN",
    min_arguments: 2,
    max_arguments: Some(2),
    volatile: true,
    call: |arguments, context| {
        done((|| {
            let least = number(arguments.first(), context)?.ceil();
            let most = number(arguments.get(1), context)?.floor();

            if least > most {
                return Ok(Value::Error(Error::Number));
            }

            // Both ends included, as Excel has it: `RANDBETWEEN(1,6)` is a
            // die, not a die that never shows a six.
            let span = most - least + 1.0;
            let landed = least + (context.cells.random() * span).floor();

            Ok(Value::Number(landed.min(most)))
        })())
    },
};

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
