//! Money over time.
//!
//! Every function here works in the same arithmetic — a sum now, a sum later,
//! a payment repeated in between — and every one of them uses the sign
//! convention that catches people out: money going out is negative. A loan is
//! a positive amount received and a column of negative payments, and `PMT`
//! answers with a negative number because a payment is money leaving. A
//! spreadsheet that returned a friendly positive would disagree with every
//! other cell in the column it was added to.
//!
//! Four of them cannot be solved for directly — `RATE`, `IRR`, `XIRR` — so
//! they are searched for. A search that does not arrive says `#NUM!` rather
//! than handing back the last place it happened to be standing.

use super::{done, flattened, number, numbers, table, Function};
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

function!(PMT, "PMT", 3, Some(5), |arguments, context| {
    done((|| {
        let (rate, periods, present, future, at_start) = terms(arguments, context)?;
        Ok(Value::Number(payment(
            rate, periods, present, future, at_start,
        )))
    })())
});

function!(FV, "FV", 3, Some(5), |arguments, context| {
    done((|| {
        let rate = number(arguments.first(), context)?;
        let periods = number(arguments.get(1), context)?;
        let paid = number(arguments.get(2), context)?;
        let present = optional(arguments.get(3), context)?;
        let at_start = timing(arguments.get(4), context)?;

        Ok(Value::Number(future(
            rate, periods, paid, present, at_start,
        )))
    })())
});

function!(PV, "PV", 3, Some(5), |arguments, context| {
    done((|| {
        let rate = number(arguments.first(), context)?;
        let periods = number(arguments.get(1), context)?;
        let paid = number(arguments.get(2), context)?;
        let later = optional(arguments.get(3), context)?;
        let at_start = timing(arguments.get(4), context)?;

        if rate == 0.0 {
            return Ok(Value::Number(-(later + paid * periods)));
        }

        let growth = (1.0 + rate).powf(periods);
        let annuity = (growth - 1.0) / rate * if at_start { 1.0 + rate } else { 1.0 };

        Ok(Value::Number(-(later + paid * annuity) / growth))
    })())
});

function!(NPER, "NPER", 3, Some(5), |arguments, context| {
    done((|| {
        let rate = number(arguments.first(), context)?;
        let paid = number(arguments.get(1), context)?;
        let present = number(arguments.get(2), context)?;
        let later = optional(arguments.get(3), context)?;
        let at_start = timing(arguments.get(4), context)?;

        if rate == 0.0 {
            if paid == 0.0 {
                return Ok(Value::Error(Error::Number));
            }
            return Ok(Value::Number(-(present + later) / paid));
        }

        let adjusted = paid * if at_start { 1.0 + rate } else { 1.0 } / rate;
        let top = adjusted - later;
        let bottom = present + adjusted;

        // A loan that will never be paid off has no number of payments, and
        // the logarithm is where that shows up.
        if top / bottom <= 0.0 {
            return Ok(Value::Error(Error::Number));
        }

        Ok(Value::Number((top / bottom).ln() / (1.0 + rate).ln()))
    })())
});

function!(RATE, "RATE", 3, Some(6), |arguments, context| {
    done((|| {
        let periods = number(arguments.first(), context)?;
        let paid = number(arguments.get(1), context)?;
        let present = number(arguments.get(2), context)?;
        let later = optional(arguments.get(3), context)?;
        let at_start = timing(arguments.get(4), context)?;
        let guess = match arguments.get(5) {
            None => 0.1,
            Some(_) => number(arguments.get(5), context)?,
        };

        // There is no closed form for the rate, so it is searched for: the
        // rate that makes the payments and the sums agree.
        let found = search(guess, |rate| {
            future(rate, periods, paid, present, at_start) - later
        });

        match found {
            Some(rate) => Ok(Value::Number(rate)),
            None => Ok(Value::Error(Error::Number)),
        }
    })())
});

function!(IPMT, "IPMT", 4, Some(6), |arguments, context| {
    done(part_of_a_payment(arguments, context, true))
});

function!(PPMT, "PPMT", 4, Some(6), |arguments, context| {
    done(part_of_a_payment(arguments, context, false))
});

function!(NPV, "NPV", 2, None, |arguments, context| {
    done((|| {
        let rate = number(arguments.first(), context)?;
        if rate <= -1.0 {
            return Ok(Value::Error(Error::Number));
        }

        let amounts = numbers(&flattened(&arguments[1..], context), true)?;
        let mut total = 0.0;

        // The first amount is discounted by one period, not by none: `NPV`
        // holds that every sum given to it is at the *end* of a period, which
        // is why an investment made today is added outside the function
        // rather than passed to it.
        for (period, amount) in amounts.iter().enumerate() {
            total += amount / (1.0 + rate).powi(period as i32 + 1);
        }

        Ok(Value::Number(total))
    })())
});

function!(IRR, "IRR", 1, Some(2), |arguments, context| {
    done((|| {
        let amounts = numbers(
            &[table(arguments.first(), context).map(Value::Array)?],
            false,
        )?;
        let guess = match arguments.get(1) {
            None => 0.1,
            Some(_) => number(arguments.get(1), context)?,
        };

        // Here the first amount *is* at time nought, which is the opposite of
        // `NPV`'s rule about the same list. Excel has both and this is not
        // the place to improve on it.
        let found = search(guess, |rate| {
            amounts
                .iter()
                .enumerate()
                .map(|(period, amount)| amount / (1.0 + rate).powi(period as i32))
                .sum()
        });

        match found {
            Some(rate) => Ok(Value::Number(rate)),
            None => Ok(Value::Error(Error::Number)),
        }
    })())
});

function!(XNPV, "XNPV", 3, Some(3), |arguments, context| {
    done((|| {
        let rate = number(arguments.first(), context)?;
        let (amounts, days) = dated(arguments, context)?;

        Ok(Value::Number(present_worth(rate, &amounts, &days)))
    })())
});

function!(XIRR, "XIRR", 2, Some(3), |arguments, context| {
    done((|| {
        let (amounts, days) = dated(&arguments[..2], context)?;
        let guess = match arguments.get(2) {
            None => 0.1,
            Some(_) => number(arguments.get(2), context)?,
        };

        let found = search(guess, |rate| present_worth(rate, &amounts, &days));
        match found {
            Some(rate) => Ok(Value::Number(rate)),
            None => Ok(Value::Error(Error::Number)),
        }
    })())
});

function!(SLN, "SLN", 3, Some(3), |arguments, context| {
    done((|| {
        let cost = number(arguments.first(), context)?;
        let left = number(arguments.get(1), context)?;
        let life = number(arguments.get(2), context)?;

        if life == 0.0 {
            return Ok(Value::Error(Error::DivideByZero));
        }

        // The same amount every year, which is the whole of what "straight
        // line" means.
        Ok(Value::Number((cost - left) / life))
    })())
});

function!(DB, "DB", 4, Some(5), |arguments, context| {
    done((|| {
        let cost = number(arguments.first(), context)?;
        let left = number(arguments.get(1), context)?;
        let life = number(arguments.get(2), context)?;
        let period = number(arguments.get(3), context)?;
        let months = match arguments.get(4) {
            None => 12.0,
            Some(_) => number(arguments.get(4), context)?.trunc(),
        };

        if cost <= 0.0 || life <= 0.0 || period <= 0.0 || !(1.0..=12.0).contains(&months) {
            return Ok(Value::Error(Error::Number));
        }
        if period > life + 1.0 {
            return Ok(Value::Error(Error::Number));
        }

        // The rate is rounded to three decimals before anything is worked
        // out. That is not a tidy-up: the rounded rate is what every later
        // year is calculated from, so the rounding is part of the answer.
        let rate = round_to(1.0 - (left / cost).powf(1.0 / life), 3);

        let first = cost * rate * months / 12.0;
        if period == 1.0 {
            return Ok(Value::Number(first));
        }

        let mut taken = first;
        let mut year = 2.0;
        let mut written = 0.0;

        while year <= period {
            written = if year == life + 1.0 {
                // The stub year at the end, which is what the months in the
                // first year did not use up.
                (cost - taken) * rate * (12.0 - months) / 12.0
            } else {
                (cost - taken) * rate
            };
            taken += written;
            year += 1.0;
        }

        Ok(Value::Number(written))
    })())
});

/// The five arguments the annuity functions share.
fn terms(arguments: &[Expr], context: &Context<'_>) -> Result<(f64, f64, f64, f64, bool), Error> {
    Ok((
        number(arguments.first(), context)?,
        number(arguments.get(1), context)?,
        number(arguments.get(2), context)?,
        optional(arguments.get(3), context)?,
        timing(arguments.get(4), context)?,
    ))
}

fn optional(argument: Option<&Expr>, context: &Context<'_>) -> Result<f64, Error> {
    match argument {
        None => Ok(0.0),
        Some(expression) => crate::eval::evaluate(expression, context).to_number(),
    }
}

/// Whether payments fall at the beginning of the period rather than the end.
fn timing(argument: Option<&Expr>, context: &Context<'_>) -> Result<bool, Error> {
    Ok(optional(argument, context)? != 0.0)
}

/// What has to be paid each period for the sums to come out.
fn payment(rate: f64, periods: f64, present: f64, later: f64, at_start: bool) -> f64 {
    if periods == 0.0 {
        return f64::NAN;
    }
    if rate == 0.0 {
        return -(present + later) / periods;
    }

    let growth = (1.0 + rate).powf(periods);
    let due = if at_start { 1.0 + rate } else { 1.0 };

    -(later + present * growth) * rate / ((growth - 1.0) * due)
}

/// What a sum and a run of payments come to at the end.
fn future(rate: f64, periods: f64, paid: f64, present: f64, at_start: bool) -> f64 {
    if rate == 0.0 {
        return -(present + paid * periods);
    }

    let growth = (1.0 + rate).powf(periods);
    let due = if at_start { 1.0 + rate } else { 1.0 };

    -(present * growth + paid * due * (growth - 1.0) / rate)
}

/// `IPMT` and `PPMT`: the two halves of one payment.
///
/// Every payment is the same size and made of different parts — nearly all
/// interest at the start of a mortgage and nearly all capital at the end.
/// That is the fact these two exist to show, and the reason a payment
/// schedule is worth printing.
fn part_of_a_payment(
    arguments: &[Expr],
    context: &Context<'_>,
    interest: bool,
) -> Result<Value, Error> {
    let rate = number(arguments.first(), context)?;
    let which = number(arguments.get(1), context)?;
    let periods = number(arguments.get(2), context)?;
    let present = number(arguments.get(3), context)?;
    let later = optional(arguments.get(4), context)?;
    let at_start = timing(arguments.get(5), context)?;

    if which < 1.0 || which > periods {
        return Ok(Value::Error(Error::Number));
    }

    let each = payment(rate, periods, present, later, at_start);

    // A payment made at the beginning of the first period has had no time to
    // earn interest, so none of it is interest.
    let owed = if which == 1.0 && at_start {
        0.0
    } else {
        let before = future(rate, which - 1.0, each, present, at_start);
        let charged = before * rate;
        if at_start {
            charged / (1.0 + rate)
        } else {
            charged
        }
    };

    Ok(Value::Number(if interest { owed } else { each - owed }))
}

/// Amounts and the days they fall on, counted from the first.
fn dated(arguments: &[Expr], context: &Context<'_>) -> Result<(Vec<f64>, Vec<f64>), Error> {
    let amounts = table(arguments.get(arguments.len() - 2), context)?;
    let dates = table(arguments.last(), context)?;

    if amounts.values.len() != dates.values.len() || amounts.values.is_empty() {
        return Err(Error::Number);
    }

    let mut sums = Vec::new();
    let mut days = Vec::new();
    let mut first = f64::NAN;

    for (amount, date) in amounts.values.iter().zip(dates.values.iter()) {
        let (Ok(amount), Ok(date)) = (amount.to_number(), date.to_number()) else {
            return Err(Error::Value);
        };

        if first.is_nan() {
            first = date.floor();
        }

        sums.push(amount);
        days.push(date.floor() - first);
    }

    Ok((sums, days))
}

/// What dated amounts are worth now, a year being three hundred and
/// sixty-five days whatever the calendar says about leap years.
fn present_worth(rate: f64, amounts: &[f64], days: &[f64]) -> f64 {
    amounts
        .iter()
        .zip(days.iter())
        .map(|(amount, day)| amount / (1.0 + rate).powf(day / 365.0))
        .sum()
}

/// The rate at which a function comes to nothing.
///
/// A secant search: two points, a straight line between them, and the place
/// that line crosses nought as the next guess. No derivative is needed, which
/// matters because the functions here are awkward to differentiate and easy
/// to evaluate.
///
/// A search that does not arrive answers with nothing at all. Handing back
/// the last place it was standing would be a number with no meaning, and a
/// number with no meaning in a column of money is worse than an error.
fn search(guess: f64, at: impl Fn(f64) -> f64) -> Option<f64> {
    let mut here = guess;
    let mut there = if guess == 0.0 { 0.0001 } else { guess * 1.0001 };

    let mut value_here = at(here);
    let mut value_there = at(there);

    for _ in 0..128 {
        if !value_here.is_finite() || !value_there.is_finite() {
            return None;
        }
        if value_there.abs() < 1e-10 {
            return Some(there);
        }

        let step = value_there - value_here;
        if step == 0.0 {
            return None;
        }

        let next = there - value_there * (there - here) / step;
        // Below -100 % there is nothing to find: money cannot shrink by more
        // than all of it in a period.
        if !next.is_finite() || next <= -1.0 {
            return None;
        }

        here = there;
        value_here = value_there;
        there = next;
        value_there = at(there);
    }

    None
}

fn round_to(value: f64, places: i32) -> f64 {
    let factor = 10_f64.powi(places);
    (value * factor).round() / factor
}
