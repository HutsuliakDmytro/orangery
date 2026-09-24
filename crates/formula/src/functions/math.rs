//! Arithmetic, as a spreadsheet does it.
//!
//! The rounding is the part worth being careful about. `ROUND` is half away
//! from zero, not the banker's rounding a language's own library does, so
//! `ROUND(2.5,0)` is 3 here and 2 in Rust — and a column of invoices rounded
//! the wrong way is a column that disagrees with the invoice.

use super::criteria::{all_matching, pairs};
use super::{done, number, numbers_given, strict_number, table, Function};
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
        let found = numbers_given(arguments, context)?;
        Ok(Value::Number(found.iter().sum()))
    })())
});

function!(PRODUCT, "PRODUCT", 1, None, |arguments, context| {
    done((|| {
        let found = numbers_given(arguments, context)?;
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
        let found = numbers_given(arguments, context)?;
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

/// The angle functions, and the two that convert between the units they use.
///
/// Every one of them reads its argument the strict way: a boolean or a string
/// out of a cell is `#VALUE!`, and the same written into the formula is a
/// number. `SIN(B18)` where B18 holds TRUE is an error in Excel, and
/// `COS("1")` is 0.5403 — both of those are cells of POI's
/// `FormulaEvalTestData.xlsx`, with the answers Excel cached beside them.
macro_rules! angle {
    ($constant:ident, $name:literal, $body:expr) => {
        function!($constant, $name, 1, Some(1), |arguments, context| {
            done(strict_number(arguments.first(), context).and_then($body))
        });
    };
}

angle!(SIN, "SIN", |value: f64| Ok(Value::Number(value.sin())));
angle!(COS, "COS", |value: f64| Ok(Value::Number(value.cos())));
angle!(TAN, "TAN", |value: f64| Ok(Value::Number(value.tan())));

// Outside −1 to 1 there is no angle, and Excel says so with `#NUM!`.
angle!(ASIN, "ASIN", |value: f64| if value.abs() > 1.0 {
    Ok(Value::Error(Error::Number))
} else {
    Ok(Value::Number(value.asin()))
});

angle!(ACOS, "ACOS", |value: f64| if value.abs() > 1.0 {
    Ok(Value::Error(Error::Number))
} else {
    Ok(Value::Number(value.acos()))
});

angle!(ATAN, "ATAN", |value: f64| Ok(Value::Number(value.atan())));

// The hyperbolic ones. Three take anything; two have an edge.
angle!(ASINH, "ASINH", |value: f64| Ok(Value::Number(
    value.asinh()
)));
angle!(SINH, "SINH", |value: f64| Ok(Value::Number(value.sinh())));
angle!(COSH, "COSH", |value: f64| Ok(Value::Number(value.cosh())));
angle!(TANH, "TANH", |value: f64| Ok(Value::Number(value.tanh())));

// Below 1 there is no answer: `cosh` never goes under it.
angle!(ACOSH, "ACOSH", |value: f64| if value < 1.0 {
    Ok(Value::Error(Error::Number))
} else {
    Ok(Value::Number(value.acosh()))
});

// And `tanh` never reaches 1, so its inverse stops short of it.
angle!(ATANH, "ATANH", |value: f64| if value.abs() >= 1.0 {
    Ok(Value::Error(Error::Number))
} else {
    Ok(Value::Number(value.atanh()))
});

// The angle to a point, with Excel's argument order and Excel's one quirk.
//
// `x` first and `y` second, which is the other way round from every
// programming language there is. Both of them nothing is `#DIV/0!` rather
// than nought: there is no angle to the origin, and that error is what the
// file holds for `ATAN2(B7,B7)`.
function!(ATAN2, "ATAN2", 2, Some(2), |arguments, context| {
    done((|| {
        let x = strict_number(arguments.first(), context)?;
        let y = strict_number(arguments.get(1), context)?;

        if x == 0.0 && y == 0.0 {
            return Ok(Value::Error(Error::DivideByZero));
        }

        Ok(Value::Number(y.atan2(x)))
    })())
});

angle!(RADIANS, "RADIANS", |value: f64| Ok(Value::Number(
    value.to_radians()
)));
angle!(DEGREES, "DEGREES", |value: f64| Ok(Value::Number(
    value.to_degrees()
)));

/// Which way a number is moved when it does not sit on a multiple.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Step {
    /// Down the number line: 23.5 to 23, and −23.5 to −24.
    Down,
    /// Up it: 23.5 to 24, and −23.5 to −23.
    Up,
}

/// A number moved to a multiple of another, with the sign rules Excel has.
///
/// The significance's own sign is ignored — `FLOOR.MATH(23.5, -1)` is 23, the
/// same as with 1 — and a significance of nothing is nothing, which is the
/// answer `CEILING` gives to the same question and `FLOOR` does not. Both of
/// those are in `ceiling-floor.xlsx`, which is a sheet of nothing but these
/// cases with Excel's answers written beside them.
fn stepped(value: f64, significance: f64, step: Step) -> Value {
    if significance == 0.0 {
        return Value::Number(0.0);
    }

    let size = significance.abs();
    let quotient = value / size;

    // Snapped first, so that a number a hundredth away from a multiple by the
    // width of a double is on it. `ROUND` does the same and says why.
    let quotient = crate::value::round_to_significant(quotient, 15);

    let moved = match step {
        Step::Down => quotient.floor(),
        Step::Up => quotient.ceil(),
    };

    Value::Number(moved * size)
}

/// `mode` decides what a negative number does, and only a negative one.
///
/// Zero — or nothing at all — keeps it on the number line: `FLOOR.MATH(-23.5)`
/// is −24, further from zero. Anything else turns it round to face zero, so
/// the same call with a mode of 1 is −23. `CEILING.MATH` is the mirror of it.
fn toward_zero(mode: f64, value: f64) -> bool {
    mode != 0.0 && value < 0.0
}

function!(
    FLOOR_MATH,
    "FLOOR.MATH",
    1,
    Some(3),
    |arguments, context| {
        done((|| {
            let value = strict_number(arguments.first(), context)?;
            let significance = match arguments.get(1) {
                Some(argument) => strict_number(Some(argument), context)?,
                None => 1.0,
            };
            let mode = strict_number(arguments.get(2), context)?;

            Ok(stepped(
                value,
                significance,
                if toward_zero(mode, value) {
                    Step::Up
                } else {
                    Step::Down
                },
            ))
        })())
    }
);

function!(
    CEILING_MATH,
    "CEILING.MATH",
    1,
    Some(3),
    |arguments, context| {
        done((|| {
            let value = strict_number(arguments.first(), context)?;
            let significance = match arguments.get(1) {
                Some(argument) => strict_number(Some(argument), context)?,
                None => 1.0,
            };
            let mode = strict_number(arguments.get(2), context)?;

            Ok(stepped(
                value,
                significance,
                if toward_zero(mode, value) {
                    Step::Down
                } else {
                    Step::Up
                },
            ))
        })())
    }
);

/// The pair that have no mode at all: down the number line, and up it.
///
/// `ISO.CEILING` is `CEILING.PRECISE` under the name the standard gave it, and
/// Excel keeps both.
macro_rules! precise {
    ($constant:ident, $name:literal, $step:expr) => {
        function!($constant, $name, 1, Some(2), |arguments, context| {
            done((|| {
                let value = strict_number(arguments.first(), context)?;
                let significance = match arguments.get(1) {
                    Some(argument) => strict_number(Some(argument), context)?,
                    None => 1.0,
                };

                Ok(stepped(value, significance, $step))
            })())
        });
    };
}

precise!(FLOOR_PRECISE, "FLOOR.PRECISE", Step::Down);
precise!(CEILING_PRECISE, "CEILING.PRECISE", Step::Up);
precise!(ISO_CEILING, "ISO.CEILING", Step::Up);

// Away from zero to the next even number, or the next odd one.
//
// `EVEN(0)` is 0 and `ODD(0)` is 1, which is the pair's one asymmetry:
// nothing is already even and is not already odd.
function!(EVEN, "EVEN", 1, Some(1), |arguments, context| {
    done(strict_number(arguments.first(), context).map(|value| {
        if value == 0.0 {
            return Value::Number(0.0);
        }

        let steps = crate::value::round_to_significant(value.abs() / 2.0, 15).ceil();
        Value::Number(steps * 2.0 * value.signum())
    }))
});

function!(ODD, "ODD", 1, Some(1), |arguments, context| {
    done(strict_number(arguments.first(), context).map(|value| {
        if value == 0.0 {
            return Value::Number(1.0);
        }

        let steps = crate::value::round_to_significant((value.abs() + 1.0) / 2.0, 15).ceil();
        Value::Number((steps * 2.0 - 1.0) * value.signum())
    }))
});

// The nearest multiple, with a half going away from zero.
//
// A multiple of nothing is nothing. A multiple whose sign disagrees with the
// number's is `#NUM!`: there is no multiple of −3 near 10.
function!(MROUND, "MROUND", 2, Some(2), |arguments, context| {
    done((|| {
        let value = strict_number(arguments.first(), context)?;
        let multiple = strict_number(arguments.get(1), context)?;

        if multiple == 0.0 {
            return Ok(Value::Number(0.0));
        }
        if value != 0.0 && value.signum() != multiple.signum() {
            return Ok(Value::Error(Error::Number));
        }

        let quotient = crate::value::round_to_significant(value / multiple, 15);
        // Half away from zero, the way a spreadsheet rounds and Rust does not.
        let steps = quotient.abs().floor()
            + if quotient.abs().fract() >= 0.5 {
                1.0
            } else {
                0.0
            };

        Ok(Value::Number(steps * quotient.signum() * multiple))
    })())
});

// The factorial of a number with its fraction thrown away.
//
// `FACT(2.99999)` is 2, which is `FACT(2)`. Above 170 the answer is larger
// than a double can hold and Excel says `#NUM!` rather than infinity.
function!(FACT, "FACT", 1, Some(1), |arguments, context| {
    done(strict_number(arguments.first(), context).map(|value| {
        let whole = value.trunc();

        if whole < 0.0 || whole > 170.0 {
            return Value::Error(Error::Number);
        }

        let mut total = 1.0_f64;
        let mut step = 2.0_f64;
        while step <= whole {
            total *= step;
            step += 1.0;
        }

        Value::Number(total)
    }))
});
