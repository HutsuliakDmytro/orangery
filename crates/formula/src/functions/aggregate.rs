//! The totals that leave some cells out.
//!
//! `SUM` over a filtered table is the classic wrong answer in a spreadsheet:
//! it adds the rows nobody can see, and the figure at the bottom disagrees
//! with the figures above it. `SUBTOTAL` is the function that does not, and
//! `AGGREGATE` is the same idea grown a second dimension — it can also be
//! told to pass over errors, which is what somebody wants when one broken
//! cell in a thousand is stopping the total.
//!
//! Both of them leave out cells that hold totals of their own. A column with
//! subtotals down it and a grand total at the bottom is the ordinary shape of
//! a report, and a grand total that counted the subtotals would count every
//! figure twice.
//!
//! Which rows are out of sight is not a question about a value, so it is
//! asked of whoever holds the sheet (`Cells::standing`).

use super::{done, number, Function};
use crate::ast::Expr;
use crate::eval::{evaluate, reference_of, Context};
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

/// What a total is being asked to pass over.
#[derive(Debug, Clone, Copy, Default)]
struct Skip {
    /// Rows a filter has hidden. Every `SUBTOTAL` does this.
    filtered: bool,
    /// Rows somebody hid by hand. Only the hundreds do.
    hidden: bool,
    /// Cells holding totals of their own. Everything here does, except the
    /// `AGGREGATE` options that say otherwise.
    totals: bool,
    /// Errors, which `AGGREGATE` can be told to step over.
    errors: bool,
}

function!(SUBTOTAL, "SUBTOTAL", 2, None, |arguments, context| {
    done((|| {
        let kind = number(arguments.first(), context)?.trunc();

        // One to eleven, or the same eleven with a hundred added. The
        // hundreds leave out the rows somebody hid by hand as well as the
        // ones a filter hid; hiding a row and filtering a table are
        // different acts, and this is where a formula can tell them apart.
        let (which, by_hand) = if (101.0..=111.0).contains(&kind) {
            (kind - 100.0, true)
        } else if (1.0..=11.0).contains(&kind) {
            (kind, false)
        } else {
            return Ok(Value::Error(Error::Value));
        };

        let skip = Skip {
            filtered: true,
            hidden: by_hand,
            totals: true,
            errors: false,
        };

        let values = gathered(&arguments[1..], context, skip)?;
        worked_out(which, &values, None)
    })())
});

function!(AGGREGATE, "AGGREGATE", 2, None, |arguments, context| {
    done((|| {
        let which = number(arguments.first(), context)?.trunc();
        let option = number(arguments.get(1), context)?.trunc();

        if !(1.0..=19.0).contains(&which) || !(0.0..=7.0).contains(&option) {
            return Ok(Value::Error(Error::Value));
        }

        // The options are two questions in one number: whether to pass over
        // hidden rows, and whether to pass over errors. Nested totals are
        // left out by all of them except four and six, which say "leave out
        // nothing" and "errors only".
        let option = option as i64;
        let skip = Skip {
            filtered: matches!(option, 1 | 3 | 5 | 7),
            hidden: matches!(option, 1 | 3 | 5 | 7),
            totals: matches!(option, 0..=3),
            errors: matches!(option, 2 | 3 | 6 | 7),
        };

        // Fourteen upwards take one more argument — which largest, which
        // percentile — and it is not one of the ranges being totalled.
        let takes_a_rank = which >= 14.0;
        let last = arguments.len() - 1;
        let ranges = if takes_a_rank {
            &arguments[2..last]
        } else {
            &arguments[2..]
        };

        if ranges.is_empty() {
            return Ok(Value::Error(Error::Value));
        }

        let rank = if takes_a_rank {
            Some(number(arguments.get(last), context)?)
        } else {
            None
        };

        let values = gathered(ranges, context, skip)?;
        worked_out(which, &values, rank)
    })())
});

/// The values a list of arguments reaches, with what a total leaves out left
/// out.
///
/// A range is walked cell by cell rather than read as a block, because what
/// is being asked about each one is where it sits rather than what it says.
/// An argument that names no place — an array, a number — has no rows to
/// hide, so it comes through whole.
fn gathered(arguments: &[Expr], context: &Context<'_>, skip: Skip) -> Result<Vec<Value>, Error> {
    let mut found = Vec::new();

    for argument in arguments {
        let Some(rect) = reference_of(argument, context) else {
            match evaluate(argument, context) {
                Value::Array(array) => found.extend(array.values),
                value => found.push(value),
            }
            continue;
        };

        let sheet = rect.sheet.as_deref();
        for row in rect.top..=rect.bottom {
            for column in rect.left..=rect.right {
                let standing = context.cells.standing(sheet, row, column);

                if skip.filtered && standing.filtered {
                    continue;
                }
                if skip.hidden && standing.hidden {
                    continue;
                }
                if skip.totals && standing.a_total {
                    continue;
                }

                let value = context.cells.value_at(sheet, row, column);
                if skip.errors && value.is_error() {
                    continue;
                }

                found.push(value);
            }
        }
    }

    Ok(found)
}

/// Excel's numbering of the eleven — and then nineteen — things a total can
/// be.
fn worked_out(which: f64, values: &[Value], rank: Option<f64>) -> Result<Value, Error> {
    use super::stats::{at_fraction, mode_of, place_in, variance};

    // Counting is the one pair that does not want numbers: `COUNT` counts
    // the numbers and `COUNTA` counts everything that is there.
    if which == 2.0 {
        let how_many = values
            .iter()
            .filter(|value| matches!(value, Value::Number(_)))
            .count();
        return Ok(Value::Number(how_many as f64));
    }
    if which == 3.0 {
        let how_many = values
            .iter()
            .filter(|value| !matches!(value, Value::Blank))
            .count();
        return Ok(Value::Number(how_many as f64));
    }

    let mut found = super::numbers(values, false)?;

    let answer = match which {
        1.0 => {
            if found.is_empty() {
                return Ok(Value::Error(Error::DivideByZero));
            }
            found.iter().sum::<f64>() / found.len() as f64
        }
        4.0 => found.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        5.0 => found.iter().copied().fold(f64::INFINITY, f64::min),
        6.0 => found.iter().product(),
        7.0 => variance(&found, true)?.sqrt(),
        8.0 => variance(&found, false)?.sqrt(),
        9.0 => found.iter().sum(),
        10.0 => variance(&found, true)?,
        11.0 => variance(&found, false)?,

        12.0 => {
            if found.is_empty() {
                return Ok(Value::Error(Error::Number));
            }
            found.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let middle = found.len() / 2;
            if found.len() % 2 == 0 {
                (found[middle - 1] + found[middle]) / 2.0
            } else {
                found[middle]
            }
        }
        13.0 => match mode_of(&found) {
            Some(value) => value,
            None => return Ok(Value::Error(Error::NotAvailable)),
        },

        // The five that take a rank: which largest, which smallest, which
        // percentile, which quarter.
        _ => {
            let Some(rank) = rank else {
                return Ok(Value::Error(Error::Value));
            };
            if found.is_empty() {
                return Ok(Value::Error(Error::Number));
            }

            found.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let size = found.len() as f64;

            let place = match which {
                14.0 => {
                    if rank < 1.0 || rank > size {
                        return Ok(Value::Error(Error::Number));
                    }
                    size - rank.trunc()
                }
                15.0 => {
                    if rank < 1.0 || rank > size {
                        return Ok(Value::Error(Error::Number));
                    }
                    rank.trunc() - 1.0
                }
                16.0 => match place_in(size, rank, true) {
                    Some(place) => place,
                    None => return Ok(Value::Error(Error::Number)),
                },
                17.0 => {
                    if !(0.0..=4.0).contains(&rank.trunc()) {
                        return Ok(Value::Error(Error::Number));
                    }
                    match place_in(size, rank.trunc() / 4.0, true) {
                        Some(place) => place,
                        None => return Ok(Value::Error(Error::Number)),
                    }
                }
                18.0 => match place_in(size, rank, false) {
                    Some(place) => place,
                    None => return Ok(Value::Error(Error::Number)),
                },
                _ => {
                    if !(1.0..=3.0).contains(&rank.trunc()) {
                        return Ok(Value::Error(Error::Number));
                    }
                    match place_in(size, rank.trunc() / 4.0, false) {
                        Some(place) => place,
                        None => return Ok(Value::Error(Error::Number)),
                    }
                }
            };

            return Ok(Value::Number(at_fraction(&mut found, place)));
        }
    };

    // An empty `MAX` or `MIN` is nought, as it is everywhere else in Excel.
    Ok(Value::Number(if answer.is_infinite() {
        0.0
    } else {
        answer
    }))
}
