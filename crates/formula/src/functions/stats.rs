//! Counting and averaging.
//!
//! The difference between `COUNT` and `COUNTA` is the whole of what people get
//! wrong about spreadsheets: one counts numbers and the other counts anything
//! at all, and a column of part numbers counted with the first comes to
//! nought. Both are here and neither is the default.

use super::criteria::{all_matching, pairs};
use super::{done, flattened, number, numbers, numbers_given, table, Function};
use crate::ast::Expr;
use crate::eval::Context;
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
        let found = numbers_given(arguments, context)?;
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
        let found = numbers_given(arguments, context)?;
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
        let found = numbers_given(arguments, context)?;
        Ok(Value::Number(
            found.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        ))
    })())
    .clamp_empty()
});

function!(MEDIAN, "MEDIAN", 1, None, |arguments, context| {
    done((|| {
        let mut found = numbers_given(arguments, context)?;
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

function!(COUNTIFS, "COUNTIFS", 2, None, |arguments, context| {
    done((|| {
        let tests = pairs(arguments, 0, context)?;
        Ok(Value::Number(all_matching(&tests)?.len() as f64))
    })())
});

function!(AVERAGEIFS, "AVERAGEIFS", 3, None, |arguments, context| {
    done((|| {
        let averaged = table(arguments.first(), context)?;
        let tests = pairs(arguments, 1, context)?;

        if tests
            .first()
            .is_some_and(|(range, _)| range.values.len() != averaged.values.len())
        {
            return Ok(Value::Error(Error::Value));
        }

        let mut total = 0.0;
        let mut how_many = 0usize;

        for index in all_matching(&tests)? {
            if let Some(Value::Number(number)) = averaged.values.get(index) {
                total += number;
                how_many += 1;
            }
        }

        if how_many == 0 {
            return Ok(Value::Error(Error::DivideByZero));
        }

        Ok(Value::Number(total / how_many as f64))
    })())
});

function!(MODE, "MODE", 1, None, most_often);
function!(MODE_SNGL, "MODE.SNGL", 1, None, most_often);

function!(VAR, "VAR", 1, None, sample_variance);
function!(VAR_S, "VAR.S", 1, None, sample_variance);
function!(VARP, "VARP", 1, None, whole_variance);
function!(VAR_P, "VAR.P", 1, None, whole_variance);

function!(STDEV, "STDEV", 1, None, sample_deviation);
function!(STDEV_S, "STDEV.S", 1, None, sample_deviation);
function!(STDEVP, "STDEVP", 1, None, whole_deviation);
function!(STDEV_P, "STDEV.P", 1, None, whole_deviation);

function!(RANK, "RANK", 2, Some(3), equal_rank);
function!(RANK_EQ, "RANK.EQ", 2, Some(3), equal_rank);
function!(RANK_AVG, "RANK.AVG", 2, Some(3), average_rank);

function!(LARGE, "LARGE", 2, Some(2), |arguments, context| {
    done(nth_from_the_end(arguments, context, true))
});

function!(SMALL, "SMALL", 2, Some(2), |arguments, context| {
    done(nth_from_the_end(arguments, context, false))
});

function!(PERCENTILE, "PERCENTILE", 2, Some(2), inclusive_percentile);
function!(
    PERCENTILE_INC,
    "PERCENTILE.INC",
    2,
    Some(2),
    inclusive_percentile
);
function!(
    PERCENTILE_EXC,
    "PERCENTILE.EXC",
    2,
    Some(2),
    exclusive_percentile
);

function!(QUARTILE, "QUARTILE", 2, Some(2), inclusive_quartile);
function!(QUARTILE_INC, "QUARTILE.INC", 2, Some(2), inclusive_quartile);
function!(QUARTILE_EXC, "QUARTILE.EXC", 2, Some(2), exclusive_quartile);

function!(CORREL, "CORREL", 2, Some(2), |arguments, context| {
    done((|| {
        let (first, second) = both(arguments, context)?;
        match correlation(&first, &second) {
            Some(value) => Ok(Value::Number(value)),
            None => Ok(Value::Error(Error::DivideByZero)),
        }
    })())
});

function!(FORECAST, "FORECAST", 3, Some(3), straight_line);
function!(
    FORECAST_LINEAR,
    "FORECAST.LINEAR",
    3,
    Some(3),
    straight_line
);

/// The value that turns up most often, and the first of them if several do.
///
/// Nothing repeated is `#N/A` rather than nought: a list where everything
/// happens once has no most-common thing, and saying so is the answer.
fn most_often(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let found = numbers_given(arguments, context)?;
        match mode_of(&found) {
            Some(value) => Ok(Value::Number(value)),
            None => Ok(Value::Error(Error::NotAvailable)),
        }
    })())
}

/// The number that turns up most often, or nothing if none turns up twice.
pub(crate) fn mode_of(found: &[f64]) -> Option<f64> {
    // Strictly more than the best so far, so the first of a tie wins.
    let mut best: Option<(f64, usize)> = None;

    for value in found {
        let seen = found.iter().filter(|other| *other == value).count();
        let better = match best {
            None => seen > 1,
            Some((_, most)) => seen > most,
        };
        if better {
            best = Some((*value, seen));
        }
    }

    best.map(|(value, _)| value)
}

/// How far along a sorted list a fraction falls, under either rule.
///
/// The inclusive kind spreads the fraction across the numbers given; the
/// exclusive kind pretends there is one more at each end and refuses to
/// answer about a fraction that would fall outside them.
pub(crate) fn place_in(size: f64, fraction: f64, inclusive: bool) -> Option<f64> {
    if inclusive {
        if !(0.0..=1.0).contains(&fraction) {
            return None;
        }
        return Some(fraction * (size - 1.0));
    }

    if fraction < 1.0 / (size + 1.0) || fraction > size / (size + 1.0) {
        return None;
    }

    Some(fraction * (size + 1.0) - 1.0)
}

/// The spread of a sample, and of a whole population.
///
/// The difference is the denominator and it is not a detail: a sample divides
/// by one fewer because it is standing in for something larger, and a table
/// of every branch there is divides by all of them. Excel has both under four
/// names apiece, because the names changed in 2010 and the files did not.
pub(crate) fn variance(found: &[f64], of_a_sample: bool) -> Result<f64, Error> {
    let least = if of_a_sample { 2 } else { 1 };
    if found.len() < least {
        return Err(Error::DivideByZero);
    }

    let mean = found.iter().sum::<f64>() / found.len() as f64;
    let squares: f64 = found.iter().map(|value| (value - mean).powi(2)).sum();
    let over = if of_a_sample {
        found.len() as f64 - 1.0
    } else {
        found.len() as f64
    };

    Ok(squares / over)
}

fn spread(arguments: &[Expr], context: &Context<'_>, of_a_sample: bool, root: bool) -> Value {
    done((|| {
        let found = numbers_given(arguments, context)?;
        let value = variance(&found, of_a_sample)?;
        Ok(Value::Number(if root { value.sqrt() } else { value }))
    })())
}

fn sample_variance(arguments: &[Expr], context: &Context<'_>) -> Value {
    spread(arguments, context, true, false)
}

fn whole_variance(arguments: &[Expr], context: &Context<'_>) -> Value {
    spread(arguments, context, false, false)
}

fn sample_deviation(arguments: &[Expr], context: &Context<'_>) -> Value {
    spread(arguments, context, true, true)
}

fn whole_deviation(arguments: &[Expr], context: &Context<'_>) -> Value {
    spread(arguments, context, false, true)
}

/// Where a number comes in a list, counting from the top unless asked
/// otherwise.
///
/// The third argument is nought or missing for "largest first", which is the
/// order a league table is in and the one nobody has to be told.
fn ranking(arguments: &[Expr], context: &Context<'_>) -> Result<(f64, Vec<f64>, bool), Error> {
    let wanted = number(arguments.first(), context)?;
    let found = numbers(
        &[table(arguments.get(1), context).map(Value::Array)?],
        false,
    )?;
    let ascending = match arguments.get(2) {
        None => false,
        Some(_) => number(arguments.get(2), context)? != 0.0,
    };

    Ok((wanted, found, ascending))
}

fn equal_rank(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let (wanted, found, ascending) = ranking(arguments, context)?;

        if !found.contains(&wanted) {
            return Ok(Value::Error(Error::NotAvailable));
        }

        let ahead = found
            .iter()
            .filter(|value| {
                if ascending {
                    **value < wanted
                } else {
                    **value > wanted
                }
            })
            .count();

        Ok(Value::Number(ahead as f64 + 1.0))
    })())
}

fn average_rank(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let (wanted, found, ascending) = ranking(arguments, context)?;

        if !found.contains(&wanted) {
            return Ok(Value::Error(Error::NotAvailable));
        }

        let ahead = found
            .iter()
            .filter(|value| {
                if ascending {
                    **value < wanted
                } else {
                    **value > wanted
                }
            })
            .count();
        let tied = found.iter().filter(|value| **value == wanted).count();

        // Three in second place are all in third, which is the average of
        // second, third and fourth.
        Ok(Value::Number(
            ahead as f64 + 1.0 + (tied as f64 - 1.0) / 2.0,
        ))
    })())
}

fn nth_from_the_end(
    arguments: &[Expr],
    context: &Context<'_>,
    largest: bool,
) -> Result<Value, Error> {
    let mut found = numbers(
        &[table(arguments.first(), context).map(Value::Array)?],
        false,
    )?;
    let which = number(arguments.get(1), context)?.trunc();

    if found.is_empty() || which < 1.0 || which > found.len() as f64 {
        return Ok(Value::Error(Error::Number));
    }

    found.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let index = if largest {
        found.len() - which as usize
    } else {
        which as usize - 1
    };

    Ok(Value::Number(found[index]))
}

/// The value a fraction of the way through a sorted list.
///
/// Between two of them it is interpolated rather than rounded to one: the
/// median of an even list is the average of the middle pair, and a percentile
/// is the same idea at any other fraction.
pub(crate) fn at_fraction(found: &mut [f64], place: f64) -> f64 {
    found.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let below = place.floor() as usize;
    let part = place - place.floor();

    if below + 1 >= found.len() {
        return found[found.len() - 1];
    }

    found[below] + part * (found[below + 1] - found[below])
}

fn percentile(
    arguments: &[Expr],
    context: &Context<'_>,
    inclusive: bool,
    fraction: f64,
) -> Result<Value, Error> {
    let mut found = numbers(
        &[table(arguments.first(), context).map(Value::Array)?],
        false,
    )?;
    if found.is_empty() {
        return Ok(Value::Error(Error::Number));
    }

    // The exclusive kind leaves out the ends: with ten numbers it will not
    // answer about the 5th percentile, because it holds that the sample says
    // nothing about what lies outside it.
    let Some(place) = place_in(found.len() as f64, fraction, inclusive) else {
        return Ok(Value::Error(Error::Number));
    };

    Ok(Value::Number(at_fraction(&mut found, place)))
}

fn inclusive_percentile(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let fraction = number(arguments.get(1), context)?;
        percentile(arguments, context, true, fraction)
    })())
}

fn exclusive_percentile(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let fraction = number(arguments.get(1), context)?;
        percentile(arguments, context, false, fraction)
    })())
}

fn inclusive_quartile(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let quarter = number(arguments.get(1), context)?.trunc();
        if !(0.0..=4.0).contains(&quarter) {
            return Ok(Value::Error(Error::Number));
        }
        percentile(arguments, context, true, quarter / 4.0)
    })())
}

fn exclusive_quartile(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let quarter = number(arguments.get(1), context)?.trunc();
        if !(1.0..=3.0).contains(&quarter) {
            return Ok(Value::Error(Error::Number));
        }
        percentile(arguments, context, false, quarter / 4.0)
    })())
}

/// Two ranges as pairs of numbers, which is what a correlation is about.
///
/// A pair where either side is not a number is left out whole: half a pair
/// says nothing about how the two move together.
fn both(arguments: &[Expr], context: &Context<'_>) -> Result<(Vec<f64>, Vec<f64>), Error> {
    let first = table(arguments.first(), context)?;
    let second = table(arguments.get(1), context)?;

    if first.values.len() != second.values.len() {
        return Err(Error::NotAvailable);
    }

    let mut here = Vec::new();
    let mut there = Vec::new();

    for (left, right) in first.values.iter().zip(second.values.iter()) {
        if let (Value::Number(a), Value::Number(b)) = (left, right) {
            here.push(*a);
            there.push(*b);
        }
    }

    Ok((here, there))
}

fn correlation(first: &[f64], second: &[f64]) -> Option<f64> {
    if first.len() < 2 {
        return None;
    }

    let size = first.len() as f64;
    let mean_here = first.iter().sum::<f64>() / size;
    let mean_there = second.iter().sum::<f64>() / size;

    let mut together = 0.0;
    let mut here_squared = 0.0;
    let mut there_squared = 0.0;

    for (a, b) in first.iter().zip(second.iter()) {
        together += (a - mean_here) * (b - mean_there);
        here_squared += (a - mean_here).powi(2);
        there_squared += (b - mean_there).powi(2);
    }

    // A column that never changes has no correlation with anything: there is
    // nothing for the other column to move with.
    if here_squared == 0.0 || there_squared == 0.0 {
        return None;
    }

    Some(together / (here_squared * there_squared).sqrt())
}

/// The straight line through the points, read at one more x.
fn straight_line(arguments: &[Expr], context: &Context<'_>) -> Value {
    done((|| {
        let at = number(arguments.first(), context)?;
        let (values, along) = both(&arguments[1..], context)?;

        if values.len() < 2 {
            return Ok(Value::Error(Error::NotAvailable));
        }

        let size = values.len() as f64;
        let mean_along = along.iter().sum::<f64>() / size;
        let mean_values = values.iter().sum::<f64>() / size;

        let mut together = 0.0;
        let mut spread = 0.0;
        for (y, x) in values.iter().zip(along.iter()) {
            together += (x - mean_along) * (y - mean_values);
            spread += (x - mean_along).powi(2);
        }

        if spread == 0.0 {
            return Ok(Value::Error(Error::DivideByZero));
        }

        let slope = together / spread;
        Ok(Value::Number(mean_values + slope * (at - mean_along)))
    })())
}

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
