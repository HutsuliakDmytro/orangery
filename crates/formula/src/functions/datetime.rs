//! Dates and times, which are numbers wearing a format.
//!
//! Every function here works in serial numbers, because that is what a cell
//! holds: `TODAY()+7` is next week for the same reason `1+7` is 8. The
//! arithmetic is in `crate::date`; what is here is the reading of arguments
//! and Excel's answers about them.
//!
//! Two of them ask what time it is. The library has no clock — the caller
//! says, through `Cells::now` — which is what makes a volatile function
//! something a test can ask twice and get the same answer from.

use super::{done, flattened, number, string, Function};
use crate::ast::Expr;
use crate::date::{date_of, end_of_month, serial_of, time_of, weekday_of, Civil, DateSystem};
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

/// The two that have to be worked out afresh every time, because the answer
/// is a fact about the world rather than about the sheet.
pub static TODAY: Function = Function {
    name: "TODAY",
    min_arguments: 0,
    max_arguments: Some(0),
    volatile: true,
    call: |_arguments, context| Value::Number(context.cells.now().floor()),
};

pub static NOW: Function = Function {
    name: "NOW",
    min_arguments: 0,
    max_arguments: Some(0),
    volatile: true,
    call: |_arguments, context| Value::Number(context.cells.now()),
};

function!(DATE, "DATE", 3, Some(3), |arguments, context| {
    done((|| {
        let year = number(arguments.first(), context)?.trunc() as i64;
        let month = number(arguments.get(1), context)?.trunc() as i64;
        let day = number(arguments.get(2), context)?.trunc() as i64;

        // Months and days are allowed to run over, which is what makes
        // `DATE(YEAR(x),MONTH(x)+1,1)` the ordinary way to say "next month"
        // and `DATE(y,m+1,0)` the ordinary way to say "the end of this one".
        match serial_of(year, month, day, context.cells.date_system()) {
            Some(serial) => Ok(Value::Number(serial)),
            None => Ok(Value::Error(Error::Number)),
        }
    })())
});

function!(TIME, "TIME", 3, Some(3), |arguments, context| {
    done((|| {
        let hours = number(arguments.first(), context)?.trunc() as i64;
        let minutes = number(arguments.get(1), context)?.trunc() as i64;
        let seconds = number(arguments.get(2), context)?.trunc() as i64;

        if hours < 0 || minutes < 0 || seconds < 0 {
            return Ok(Value::Error(Error::Number));
        }

        // Past midnight it wraps: `TIME(27,0,0)` is three in the morning,
        // which is Excel's answer and the only one that keeps a time a
        // fraction of one day.
        let total = (hours * 3600 + minutes * 60 + seconds) % 86_400;
        Ok(Value::Number(total as f64 / 86_400.0))
    })())
});

function!(YEAR, "YEAR", 1, Some(1), |arguments, context| {
    parts(arguments, context, |civil| civil.year)
});

function!(MONTH, "MONTH", 1, Some(1), |arguments, context| {
    parts(arguments, context, |civil| civil.month)
});

function!(DAY, "DAY", 1, Some(1), |arguments, context| {
    parts(arguments, context, |civil| civil.day)
});

function!(HOUR, "HOUR", 1, Some(1), |arguments, context| {
    clock(arguments, context, |(hours, _, _)| hours)
});

function!(MINUTE, "MINUTE", 1, Some(1), |arguments, context| {
    clock(arguments, context, |(_, minutes, _)| minutes)
});

function!(SECOND, "SECOND", 1, Some(1), |arguments, context| {
    clock(arguments, context, |(_, _, seconds)| seconds)
});

function!(WEEKDAY, "WEEKDAY", 1, Some(2), |arguments, context| {
    done((|| {
        let serial = date_argument(arguments.first(), context)?;
        let kind = match arguments.get(1) {
            None => 1,
            Some(_) => number(arguments.get(1), context)?.trunc() as i64,
        };

        let sunday_first = weekday_of(serial, context.cells.date_system());

        // Excel's three old numberings and the eleven-to-seventeen family
        // that says which day the week starts on.
        let answer = match kind {
            1 => sunday_first + 1,
            2 => (sunday_first + 6) % 7 + 1,
            3 => (sunday_first + 6) % 7,
            11..=17 => {
                let first = first_day_of_week(kind);
                (sunday_first - first).rem_euclid(7) + 1
            }
            _ => return Ok(Value::Error(Error::Number)),
        };

        Ok(Value::Number(answer as f64))
    })())
});

function!(WEEKNUM, "WEEKNUM", 1, Some(2), |arguments, context| {
    done((|| {
        let serial = date_argument(arguments.first(), context)?;
        let kind = match arguments.get(1) {
            None => 1,
            Some(_) => number(arguments.get(1), context)?.trunc() as i64,
        };

        if kind == 21 {
            return iso_week(serial, context);
        }

        let first = match kind {
            1 => 0,
            2 => 1,
            11..=17 => first_day_of_week(kind),
            _ => return Ok(Value::Error(Error::Number)),
        };

        let system = context.cells.date_system();
        let Some(civil) = date_of(serial, system) else {
            return Ok(Value::Error(Error::Number));
        };
        let Some(january) = serial_of(civil.year, 1, 1, system) else {
            return Ok(Value::Error(Error::Number));
        };

        // Week one is the week the first of January falls in, however few
        // days of it are in the year — which is why the 1st of January can be
        // week 1 and the 2nd week 2.
        let lead = (weekday_of(january, system) - first).rem_euclid(7);
        let week = ((serial.floor() - january + lead as f64) / 7.0).floor() + 1.0;

        Ok(Value::Number(week))
    })())
});

function!(
    ISOWEEKNUM,
    "ISOWEEKNUM",
    1,
    Some(1),
    |arguments, context| {
        done((|| {
            let serial = date_argument(arguments.first(), context)?;
            iso_week(serial, context)
        })())
    }
);

function!(EDATE, "EDATE", 2, Some(2), |arguments, context| {
    done(shift_months(arguments, context, false))
});

function!(EOMONTH, "EOMONTH", 2, Some(2), |arguments, context| {
    done(shift_months(arguments, context, true))
});

function!(DAYS, "DAYS", 2, Some(2), |arguments, context| {
    done((|| {
        // `DAYS(end, start)` — the later one first, which is the order
        // nobody remembers and the reason the answer is sometimes negative.
        let end = date_argument(arguments.first(), context)?;
        let start = date_argument(arguments.get(1), context)?;

        Ok(Value::Number(end.floor() - start.floor()))
    })())
});

function!(DATEDIF, "DATEDIF", 3, Some(3), |arguments, context| {
    done((|| {
        let start = date_argument(arguments.first(), context)?;
        let end = date_argument(arguments.get(1), context)?;
        let unit = string(arguments.get(2), context)?.to_ascii_uppercase();

        // The one function Excel has never documented properly and has
        // always refused to answer backwards.
        if end < start {
            return Ok(Value::Error(Error::Number));
        }

        let system = context.cells.date_system();
        let (Some(from), Some(to)) = (date_of(start, system), date_of(end, system)) else {
            return Ok(Value::Error(Error::Number));
        };

        let months = whole_months(from, to);

        let answer = match unit.as_str() {
            "D" => end.floor() - start.floor(),
            "Y" => (months / 12) as f64,
            "M" => months as f64,
            // The three that ignore part of the difference on purpose: how
            // many days over the whole months, months over the whole years,
            // days over the whole years.
            "MD" => {
                let back = add_months(from, months);
                end.floor() - serial_of(back.year, back.month, back.day, system).unwrap_or(0.0)
            }
            "YM" => (months % 12) as f64,
            "YD" => {
                let back = add_months(from, (months / 12) * 12);
                end.floor() - serial_of(back.year, back.month, back.day, system).unwrap_or(0.0)
            }
            _ => return Ok(Value::Error(Error::Number)),
        };

        Ok(Value::Number(answer))
    })())
});

function!(
    NETWORKDAYS,
    "NETWORKDAYS",
    2,
    Some(3),
    |arguments, context| { done(working_days(arguments, context, false)) }
);

function!(
    NETWORKDAYS_INTL,
    "NETWORKDAYS.INTL",
    2,
    Some(4),
    |arguments, context| { done(working_days(arguments, context, true)) }
);

function!(WORKDAY, "WORKDAY", 2, Some(3), |arguments, context| {
    done(working_day_after(arguments, context, false))
});

function!(
    WORKDAY_INTL,
    "WORKDAY.INTL",
    2,
    Some(4),
    |arguments, context| { done(working_day_after(arguments, context, true)) }
);

function!(DATEVALUE, "DATEVALUE", 1, Some(1), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        match parse_date(&text, context.cells.date_system()) {
            Some(serial) => Ok(Value::Number(serial)),
            None => Ok(Value::Error(Error::Value)),
        }
    })())
});

function!(TIMEVALUE, "TIMEVALUE", 1, Some(1), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        match parse_time(&text) {
            Some(fraction) => Ok(Value::Number(fraction)),
            None => Ok(Value::Error(Error::Value)),
        }
    })())
});

/// One argument as a serial number, refusing what is not a date.
///
/// A negative serial is no date at all: there is nothing before the morning
/// the workbook counts from, and `#NUM!` is what Excel says about it.
fn date_argument(argument: Option<&Expr>, context: &Context<'_>) -> Result<f64, Error> {
    let value = number(argument, context)?;
    if value < 0.0 {
        return Err(Error::Number);
    }
    Ok(value)
}

fn parts(arguments: &[Expr], context: &Context<'_>, which: fn(Civil) -> i64) -> Value {
    done((|| {
        let serial = date_argument(arguments.first(), context)?;
        match date_of(serial, context.cells.date_system()) {
            Some(civil) => Ok(Value::Number(which(civil) as f64)),
            None => Ok(Value::Error(Error::Number)),
        }
    })())
}

fn clock(arguments: &[Expr], context: &Context<'_>, which: fn((i64, i64, i64)) -> i64) -> Value {
    done((|| {
        let serial = date_argument(arguments.first(), context)?;
        Ok(Value::Number(which(time_of(serial)) as f64))
    })())
}

/// Which day the week starts on, for the `11`–`17` numbering: 11 is Monday.
fn first_day_of_week(kind: i64) -> i64 {
    (kind - 11 + 1) % 7
}

/// The ISO week number: the week holding the year's first Thursday is week 1.
///
/// Which is why the last days of December can be week 1 of the year after,
/// and the first days of January week 52 of the year before.
fn iso_week(serial: f64, context: &Context<'_>) -> Result<Value, Error> {
    let system = context.cells.date_system();
    let Some(civil) = date_of(serial, system) else {
        return Ok(Value::Error(Error::Number));
    };

    // Monday is 0 here, because ISO weeks start on one.
    let monday_first = (weekday_of(serial, system) + 6).rem_euclid(7);
    let days = crate::date::days_from_civil(civil.year, civil.month, civil.day);
    let thursday = days + (3 - monday_first);
    let year = crate::date::civil_from_days(thursday).year;

    let first = crate::date::days_from_civil(year, 1, 1);
    Ok(Value::Number(((thursday - first) / 7 + 1) as f64))
}

/// `EDATE` and `EOMONTH`, which differ only in which day of the month.
fn shift_months(
    arguments: &[Expr],
    context: &Context<'_>,
    to_the_end: bool,
) -> Result<Value, Error> {
    let start = date_argument(arguments.first(), context)?;
    let months = number(arguments.get(1), context)?.trunc() as i64;
    let system = context.cells.date_system();

    let Some(civil) = date_of(start, system) else {
        return Ok(Value::Error(Error::Number));
    };

    let moved = add_months(civil, months);
    let day = if to_the_end {
        end_of_month(moved.year, moved.month)
    } else {
        moved.day
    };

    match serial_of(moved.year, moved.month, day, system) {
        Some(serial) => Ok(Value::Number(serial)),
        None => Ok(Value::Error(Error::Number)),
    }
}

/// A date so many months along, keeping the day where the month allows it.
///
/// The 31st of January plus one month is the 29th of February in a leap year
/// and the 28th otherwise: there is no 31st to keep, and Excel takes the last
/// day there is rather than spilling into March.
fn add_months(from: Civil, months: i64) -> Civil {
    let total = from.year * 12 + (from.month - 1) + months;
    let year = total.div_euclid(12);
    let month = total.rem_euclid(12) + 1;

    Civil {
        year,
        month,
        day: from.day.min(end_of_month(year, month)),
    }
}

/// Whole months between two dates, which is months less one if the day of the
/// month has not come round yet.
fn whole_months(from: Civil, to: Civil) -> i64 {
    let months = (to.year - from.year) * 12 + (to.month - from.month);
    if to.day < from.day {
        months - 1
    } else {
        months
    }
}

/// Which days of the week are not worked, as a flag per day from Sunday.
///
/// Excel says this two ways: a number from a list it has grown twice, or a
/// string of seven noughts and ones beginning on Monday. Both are here
/// because both turn up in files.
fn weekend_days(value: &Value) -> Option<[bool; 7]> {
    let mut weekend = [false; 7];

    match value {
        Value::Text(text) if text.chars().count() == 7 => {
            for (position, letter) in text.chars().enumerate() {
                match letter {
                    '1' => weekend[(position + 1) % 7] = true,
                    '0' => {}
                    _ => return None,
                }
            }
            // A week with no day off at all is not a week Excel accepts.
            if weekend.iter().all(|day| !day) {
                return None;
            }
        }

        other => {
            let code = other.to_number().ok()?.trunc() as i64;
            match code {
                1..=7 => {
                    let first = (code + 5) % 7;
                    weekend[first as usize] = true;
                    weekend[((first + 1) % 7) as usize] = true;
                }
                11..=17 => weekend[(code - 11) as usize] = true,
                _ => return None,
            }
        }
    }

    Some(weekend)
}

/// The weekend and the holidays an argument list describes.
fn rest_days(
    arguments: &[Expr],
    context: &Context<'_>,
    international: bool,
) -> Result<([bool; 7], Vec<f64>), Error> {
    let mut weekend = [false; 7];
    weekend[0] = true;
    weekend[6] = true;

    let holidays_at = if international { 3 } else { 2 };

    if international {
        if let Some(expression) = arguments.get(2) {
            let value = crate::eval::evaluate(expression, context);
            match weekend_days(&value) {
                Some(days) => weekend = days,
                None => return Err(Error::Value),
            }
        }
    }

    let holidays = match arguments.get(holidays_at) {
        None => Vec::new(),
        Some(_) => flattened(&arguments[holidays_at..=holidays_at], context)
            .iter()
            .filter_map(|value| value.to_number().ok())
            .map(f64::floor)
            .collect(),
    };

    Ok((weekend, holidays))
}

fn is_a_working_day(
    serial: f64,
    weekend: &[bool; 7],
    holidays: &[f64],
    system: DateSystem,
) -> bool {
    if weekend[weekday_of(serial, system) as usize] {
        return false;
    }
    !holidays.contains(&serial)
}

/// How many working days there are from one date to another, both included.
fn working_days(
    arguments: &[Expr],
    context: &Context<'_>,
    international: bool,
) -> Result<Value, Error> {
    let start = date_argument(arguments.first(), context)?.floor();
    let end = date_argument(arguments.get(1), context)?.floor();
    let (weekend, holidays) = rest_days(arguments, context, international)?;
    let system = context.cells.date_system();

    // Backwards is a negative count rather than a refusal, which is what
    // Excel answers and what makes the function safe to write either way
    // round.
    let (first, last, sign) = if end >= start {
        (start, end, 1.0)
    } else {
        (end, start, -1.0)
    };

    let mut counted = 0.0;
    let mut day = first;
    while day <= last {
        if is_a_working_day(day, &weekend, &holidays, system) {
            counted += 1.0;
        }
        day += 1.0;
    }

    Ok(Value::Number(counted * sign))
}

/// The date so many working days after another one.
fn working_day_after(
    arguments: &[Expr],
    context: &Context<'_>,
    international: bool,
) -> Result<Value, Error> {
    let start = date_argument(arguments.first(), context)?.floor();
    let mut remaining = number(arguments.get(1), context)?.trunc() as i64;
    let (weekend, holidays) = rest_days(arguments, context, international)?;
    let system = context.cells.date_system();

    // A week with every day off would never arrive.
    if weekend.iter().all(|day| *day) {
        return Ok(Value::Error(Error::Value));
    }

    let step = if remaining < 0 { -1.0 } else { 1.0 };
    let mut day = start;

    while remaining != 0 {
        day += step;
        if day < 0.0 {
            return Ok(Value::Error(Error::Number));
        }
        if is_a_working_day(day, &weekend, &holidays, system) {
            remaining -= if step > 0.0 { 1 } else { -1 };
        }
    }

    Ok(Value::Number(day))
}

/// The date a piece of text names, read the way a formula is read.
///
/// English month names and the American order for a date written with
/// slashes, because a formula is stored in a file in one language whatever
/// the machine's own settings are — the same reason the stored formula says
/// `TRUE` rather than `ІСТИНА`. What somebody types into a cell is a
/// different question, answered where the typing happens.
fn parse_date(text: &str, system: DateSystem) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    // 2024-01-15, the one form nobody can misread.
    let dashed: Vec<&str> = trimmed.split('-').collect();
    if dashed.len() == 3 {
        if let (Ok(year), Ok(month), Ok(day)) = (
            dashed[0].parse::<i64>(),
            dashed[1].parse::<i64>(),
            dashed[2].parse::<i64>(),
        ) {
            return in_range(year, month, day, system);
        }

        // 15-Jan-2024 and 15-January-2024.
        if let (Ok(day), Some(month), Ok(year)) = (
            dashed[0].parse::<i64>(),
            month_named(dashed[1]),
            dashed[2].parse::<i64>(),
        ) {
            return in_range(year, month, day, system);
        }
    }

    // 1/15/2024 — month first, as en-US writes it.
    let slashed: Vec<&str> = trimmed.split('/').collect();
    if slashed.len() == 3 {
        if let (Ok(month), Ok(day), Ok(year)) = (
            slashed[0].parse::<i64>(),
            slashed[1].parse::<i64>(),
            slashed[2].parse::<i64>(),
        ) {
            return in_range(year, month, day, system);
        }
    }

    // January 15, 2024 and 15 January 2024.
    let words: Vec<&str> = trimmed
        .split([' ', ','])
        .filter(|word| !word.is_empty())
        .collect();
    if words.len() == 3 {
        if let (Some(month), Ok(day), Ok(year)) = (
            month_named(words[0]),
            words[1].parse::<i64>(),
            words[2].parse::<i64>(),
        ) {
            return in_range(year, month, day, system);
        }
        if let (Ok(day), Some(month), Ok(year)) = (
            words[0].parse::<i64>(),
            month_named(words[1]),
            words[2].parse::<i64>(),
        ) {
            return in_range(year, month, day, system);
        }
    }

    None
}

/// A date that exists, as a serial. Text naming the 32nd of a month names no
/// day, however well it parses.
fn in_range(year: i64, month: i64, day: i64, system: DateSystem) -> Option<f64> {
    if !(1..=12).contains(&month) {
        return None;
    }

    let year = if (0..=99).contains(&year) {
        // Excel's two-digit window: 00–29 is this century, 30–99 the last.
        if year <= 29 {
            year + 2000
        } else {
            year + 1900
        }
    } else {
        year
    };

    if day < 1 || day > end_of_month(year, month) {
        return None;
    }

    serial_of(year, month, day, system)
}

fn month_named(word: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];

    let word = word.trim().to_lowercase();
    if word.len() < 3 {
        return None;
    }

    MONTHS
        .iter()
        .position(|month| *month == word || month.starts_with(&word) && word.len() == 3)
        .map(|index| index as i64 + 1)
}

/// The fraction of a day a time names.
fn parse_time(text: &str) -> Option<f64> {
    let trimmed = text.trim().to_ascii_uppercase();

    let (body, half) = if let Some(rest) = trimmed.strip_suffix("AM") {
        (rest.trim().to_string(), Some(false))
    } else if let Some(rest) = trimmed.strip_suffix("PM") {
        (rest.trim().to_string(), Some(true))
    } else {
        (trimmed, None)
    };

    let pieces: Vec<&str> = body.split(':').collect();
    if pieces.len() < 2 || pieces.len() > 3 {
        return None;
    }

    let hours: i64 = pieces[0].trim().parse().ok()?;
    let minutes: i64 = pieces[1].trim().parse().ok()?;
    let seconds: f64 = match pieces.get(2) {
        None => 0.0,
        Some(piece) => piece.trim().parse().ok()?,
    };

    if minutes > 59 || seconds >= 60.0 || minutes < 0 || seconds < 0.0 {
        return None;
    }

    let hours = match half {
        // Twelve in the morning is nought, and twelve at night is twelve:
        // the one hour on the clock that does not mean what it says.
        Some(afternoon) => match (hours, afternoon) {
            (12, false) => 0,
            (12, true) => 12,
            (hour, false) if (1..=11).contains(&hour) => hour,
            (hour, true) if (1..=11).contains(&hour) => hour + 12,
            _ => return None,
        },
        None => {
            if hours > 23 {
                return None;
            }
            hours
        }
    };

    Some((hours as f64 * 3600.0 + minutes as f64 * 60.0 + seconds) / 86_400.0)
}
