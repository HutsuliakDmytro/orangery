//! Dates as a spreadsheet keeps them: a count of days, and a fraction of one.
//!
//! A date in a cell is a number. That is not an implementation detail people
//! can be spared — it is why a date can be added to, why subtracting two of
//! them gives a count of days, and why a cell that suddenly shows 45292 has
//! lost its format rather than its value.
//!
//! Two things here are wrong on purpose. The 1900 system counts a 29th of
//! February 1900 that never happened, because Lotus 1-2-3 did and Excel chose
//! to agree rather than to disagree with every file in existence; serial 60
//! is that day, and every serial after it is one more than the arithmetic
//! deserves. And the 1904 system exists at all because Excel for Mac counted
//! from a different morning until 2011, and workbooks written then are still
//! opened now.
//!
//! Nothing here reads a clock. A library that told the time would be a
//! library that could not be tested twice with the same answer.

/// Which morning a workbook counts from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DateSystem {
    /// The 1900 system, leap-day bug included. What almost every file uses.
    #[default]
    Excel1900,
    /// The 1904 system, as Excel for Mac wrote until 2011.
    Excel1904,
}

/// A day in the calendar everybody outside a spreadsheet uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Civil {
    pub year: i64,
    pub month: i64,
    pub day: i64,
}

/// Days from the civil calendar to a count from 1970-01-01.
///
/// Howard Hinnant's algorithm: exact for every year in range, and short
/// enough to read, which matters more here than either.
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

/// And back again.
pub fn civil_from_days(days: i64) -> Civil {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_of_year = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_of_year + 2) / 5 + 1;
    let month = if month_of_year < 10 {
        month_of_year + 3
    } else {
        month_of_year - 9
    };

    Civil {
        year: if month <= 2 { year + 1 } else { year },
        month,
        day,
    }
}

/// The day the 1900 system pretends to count from: 1899-12-31.
fn origin_1900() -> i64 {
    days_from_civil(1899, 12, 31)
}

fn origin_1904() -> i64 {
    days_from_civil(1904, 1, 1)
}

/// The date a serial number means, or `None` if it means no date at all.
///
/// Serial 60 in the 1900 system is the day that never was. It is handed back
/// as the 29th of February 1900 because that is what Excel shows and what
/// `DAY` answers about it — a file holding it is a file that has been through
/// a program that believed in it.
pub fn date_of(serial: f64, system: DateSystem) -> Option<Civil> {
    if serial < 0.0 {
        return None;
    }

    let whole = serial.floor() as i64;

    match system {
        DateSystem::Excel1904 => Some(civil_from_days(origin_1904() + whole)),
        DateSystem::Excel1900 => match whole {
            // Excel shows serial 0 as the zeroth of January 1900, which is
            // not a day; its parts are what the functions answer anyway.
            0 => Some(Civil {
                year: 1900,
                month: 1,
                day: 0,
            }),
            60 => Some(Civil {
                year: 1900,
                month: 2,
                day: 29,
            }),
            days if days < 60 => Some(civil_from_days(origin_1900() + days)),
            days => Some(civil_from_days(origin_1900() + days - 1)),
        },
    }
}

/// The serial number a date means, with months and days allowed to overflow.
///
/// `DATE(2024,13,1)` is January 2025 and `DATE(2024,1,32)` is the first of
/// February: Excel normalises rather than refusing, which is what makes
/// `DATE(YEAR(x),MONTH(x)+1,1)` the ordinary way to write "next month".
pub fn serial_of(year: i64, month: i64, day: i64, system: DateSystem) -> Option<f64> {
    // A year under 1900 is read as an offset from 1900, as Excel does with
    // two-digit years typed into a formula.
    let year = if (0..=1899).contains(&year) {
        year + 1900
    } else {
        year
    };

    let months = year * 12 + (month - 1);
    let (year, month) = (months.div_euclid(12), months.rem_euclid(12) + 1);

    let days = days_from_civil(year, month, 1) + (day - 1);

    let serial = match system {
        DateSystem::Excel1904 => days - origin_1904(),
        DateSystem::Excel1900 => {
            let plain = days - origin_1900();
            // Everything from the 1st of March 1900 onwards is one further
            // along than the calendar says, because of the day that never was.
            if plain > 59 {
                plain + 1
            } else {
                plain
            }
        }
    };

    if serial < 0 {
        return None;
    }

    Some(serial as f64)
}

/// The hours, minutes and seconds a fraction of a day comes to.
///
/// Rounded to the second rather than truncated: a time arrived at by
/// arithmetic is 10:59:59.9999999 as often as it is 11:00:00, and a
/// spreadsheet that showed the first would be showing its own arithmetic.
pub fn time_of(serial: f64) -> (i64, i64, i64) {
    let fraction = serial - serial.floor();
    let seconds = (fraction * 86_400.0).round() as i64;
    // Rounding can carry over midnight; the day is somebody else's question.
    let seconds = seconds % 86_400;

    (seconds / 3600, (seconds % 3600) / 60, seconds % 60)
}

/// Which day of the week a serial falls on: 0 for Sunday, 6 for Saturday.
///
/// Worked out from the serial rather than from the date, so that the 1900
/// system's fictional days line up with what Excel says about them — serial 1
/// is a Sunday there, and every file written since has agreed.
pub fn weekday_of(serial: f64, system: DateSystem) -> i64 {
    let whole = serial.floor() as i64;

    match system {
        // Serial 1 is a Sunday.
        DateSystem::Excel1900 => (whole + 6).rem_euclid(7),
        // Serial 0 is the 1st of January 1904, which was a Friday.
        DateSystem::Excel1904 => (whole + 5).rem_euclid(7),
    }
}

/// The last day of the month a date falls in.
pub fn end_of_month(year: i64, month: i64) -> i64 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };

    days_from_civil(next_year, next_month, 1) - days_from_civil(year, month, 1)
}
