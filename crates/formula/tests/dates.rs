//! Dates and times, against Excel's answers.
//!
//! The anchors are the serial numbers anybody can check in a cell: the 1st of
//! January 2024 is 45292, the 1st of January 1900 is 1, and the 60th day of
//! the 1900 system is a 29th of February that never happened. Everything else
//! here is arithmetic from those.

mod common;

use common::{on, Sheet};
use formula::value::{Error, Value};

fn answer(formula: &str) -> Value {
    on(&Sheet::default(), formula)
}

fn number(formula: &str) -> f64 {
    match answer(formula) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

/// A fraction of a day, compared as a spreadsheet would show it.
fn close(formula: &str, expected: f64) {
    let found = number(formula);
    assert!(
        (found - expected).abs() < 1e-9,
        "{formula} is {found}, not {expected}"
    );
}

#[test]
fn a_date_is_a_count_of_days() {
    assert_eq!(number("DATE(2024,1,1)"), 45292.0);
    assert_eq!(number("DATE(2024,1,15)"), 45306.0);
    assert_eq!(number("DATE(2024,12,31)"), 45657.0);
    assert_eq!(number("DATE(2025,1,1)"), 45658.0);
    assert_eq!(number("DATE(1999,12,31)"), 36525.0);
}

#[test]
fn the_1900_system_counts_a_day_that_never_happened() {
    // Lotus 1-2-3 thought 1900 was a leap year; Excel agreed rather than
    // disagree with every file in existence, and every file since has agreed
    // too. Serial 60 is that day.
    assert_eq!(number("DATE(1900,1,1)"), 1.0);
    assert_eq!(number("DATE(1900,2,28)"), 59.0);
    assert_eq!(number("DATE(1900,3,1)"), 61.0);
    assert_eq!(number("DAY(60)"), 29.0);
    assert_eq!(number("MONTH(60)"), 2.0);
    assert_eq!(number("YEAR(60)"), 1900.0);
}

#[test]
fn a_month_or_a_day_is_allowed_to_run_over() {
    // Which is what makes `DATE(YEAR(x),MONTH(x)+1,1)` the ordinary way to
    // write "the first of next month", and `DATE(y,m+1,0)` the end of this.
    assert_eq!(number("DATE(2024,13,1)"), number("DATE(2025,1,1)"));
    assert_eq!(number("DATE(2024,0,1)"), number("DATE(2023,12,1)"));
    assert_eq!(number("DATE(2024,1,0)"), number("DATE(2023,12,31)"));
    assert_eq!(number("DATE(2024,2,30)"), number("DATE(2024,3,1)"));
    assert_eq!(number("DATE(2024,1,32)"), number("DATE(2024,2,1)"));
}

#[test]
fn the_parts_of_a_date_come_back_out_of_the_number() {
    assert_eq!(number("YEAR(45292)"), 2024.0);
    assert_eq!(number("MONTH(45292)"), 1.0);
    assert_eq!(number("DAY(45292)"), 1.0);
    assert_eq!(number("YEAR(DATE(2024,2,29))"), 2024.0);
    assert_eq!(number("DAY(DATE(2024,2,29))"), 29.0);
    // The time of day is carried along and ignored.
    assert_eq!(number("DAY(45292.75)"), 1.0);
    assert_eq!(answer("YEAR(-1)"), Value::Error(Error::Number));
}

#[test]
fn a_time_is_a_fraction_of_one_day() {
    assert_eq!(number("TIME(12,0,0)"), 0.5);
    assert_eq!(number("TIME(6,0,0)"), 0.25);
    assert_eq!(number("TIME(0,0,0)"), 0.0);
    // Past midnight it wraps rather than becoming a second day.
    assert_eq!(number("TIME(27,0,0)"), number("TIME(3,0,0)"));
    close("TIME(1,2,3)", 3723.0 / 86_400.0);
    assert_eq!(answer("TIME(-1,0,0)"), Value::Error(Error::Number));
}

#[test]
fn the_parts_of_a_time_come_back_out_of_the_fraction() {
    assert_eq!(number("HOUR(0.5)"), 12.0);
    assert_eq!(number("HOUR(0.75)"), 18.0);
    assert_eq!(number("HOUR(TIME(1,2,3))"), 1.0);
    assert_eq!(number("MINUTE(TIME(1,2,3))"), 2.0);
    assert_eq!(number("SECOND(TIME(1,2,3))"), 3.0);
    // The day it is attached to makes no difference.
    assert_eq!(number("HOUR(45292.75)"), 18.0);
    assert_eq!(number("MINUTE(45292.5)"), 0.0);
}

#[test]
fn weekday_answers_in_whichever_numbering_it_was_asked() {
    // The 1st of January 2024 was a Monday.
    assert_eq!(number("WEEKDAY(DATE(2024,1,1))"), 2.0);
    assert_eq!(number("WEEKDAY(DATE(2024,1,1),1)"), 2.0);
    assert_eq!(number("WEEKDAY(DATE(2024,1,1),2)"), 1.0);
    assert_eq!(number("WEEKDAY(DATE(2024,1,1),3)"), 0.0);
    // 11 is "the week begins on Monday", 17 "the week begins on Sunday".
    assert_eq!(number("WEEKDAY(DATE(2024,1,1),11)"), 1.0);
    assert_eq!(number("WEEKDAY(DATE(2024,1,1),17)"), 2.0);
    assert_eq!(number("WEEKDAY(DATE(2024,1,7))"), 1.0);
    assert_eq!(number("WEEKDAY(DATE(2024,1,6))"), 7.0);
    assert_eq!(
        answer("WEEKDAY(DATE(2024,1,1),4)"),
        Value::Error(Error::Number)
    );
}

#[test]
fn the_1900_systems_own_weekdays_are_kept() {
    // Excel says serial 1 was a Sunday. It was a Monday, but every file
    // written since says otherwise and a reader that disagreed would put
    // every early date on the wrong day.
    assert_eq!(number("WEEKDAY(1)"), 1.0);
    assert_eq!(number("WEEKDAY(2)"), 2.0);
    // And from March 1900 onwards it agrees with the calendar again.
    assert_eq!(number("WEEKDAY(DATE(2024,1,1))"), 2.0);
}

#[test]
fn weeknum_counts_from_the_week_the_year_starts_in() {
    assert_eq!(number("WEEKNUM(DATE(2024,1,1))"), 1.0);
    assert_eq!(number("WEEKNUM(DATE(2024,1,6))"), 1.0);
    // Weeks begin on Sunday unless told otherwise, so the 7th is week two.
    assert_eq!(number("WEEKNUM(DATE(2024,1,7))"), 2.0);
    assert_eq!(number("WEEKNUM(DATE(2024,1,7),2)"), 1.0);
    assert_eq!(number("WEEKNUM(DATE(2024,1,8),2)"), 2.0);
    assert_eq!(
        answer("WEEKNUM(DATE(2024,1,1),4)"),
        Value::Error(Error::Number)
    );
}

#[test]
fn the_iso_week_is_the_one_with_the_thursday_in_it() {
    // Which is why the end of December can be week 1 of the year after, and
    // the start of January week 53 of the year before.
    assert_eq!(number("ISOWEEKNUM(DATE(2024,1,1))"), 1.0);
    assert_eq!(number("ISOWEEKNUM(DATE(2024,12,30))"), 1.0);
    assert_eq!(number("ISOWEEKNUM(DATE(2021,1,1))"), 53.0);
    assert_eq!(number("ISOWEEKNUM(DATE(2024,6,3))"), 23.0);
    assert_eq!(number("WEEKNUM(DATE(2024,12,30),21)"), 1.0);
}

#[test]
fn edate_keeps_the_day_of_the_month_where_the_month_allows_it() {
    assert_eq!(
        number("EDATE(DATE(2024,1,15),1)"),
        number("DATE(2024,2,15)")
    );
    assert_eq!(
        number("EDATE(DATE(2024,1,15),-1)"),
        number("DATE(2023,12,15)")
    );
    assert_eq!(
        number("EDATE(DATE(2024,1,15),12)"),
        number("DATE(2025,1,15)")
    );
    // There is no 31st of February to keep, so the last day there is wins
    // rather than the date spilling into March.
    assert_eq!(
        number("EDATE(DATE(2024,1,31),1)"),
        number("DATE(2024,2,29)")
    );
    assert_eq!(
        number("EDATE(DATE(2023,1,31),1)"),
        number("DATE(2023,2,28)")
    );
}

#[test]
fn eomonth_is_the_last_day_of_the_month_it_lands_in() {
    assert_eq!(
        number("EOMONTH(DATE(2024,1,15),0)"),
        number("DATE(2024,1,31)")
    );
    assert_eq!(
        number("EOMONTH(DATE(2024,1,15),1)"),
        number("DATE(2024,2,29)")
    );
    assert_eq!(
        number("EOMONTH(DATE(2023,1,15),1)"),
        number("DATE(2023,2,28)")
    );
    assert_eq!(
        number("EOMONTH(DATE(2024,3,15),-1)"),
        number("DATE(2024,2,29)")
    );
    assert_eq!(
        number("EOMONTH(DATE(2024,12,1),0)"),
        number("DATE(2024,12,31)")
    );
}

#[test]
fn days_counts_from_the_later_one_backwards() {
    // The argument order nobody remembers, and the reason the answer is
    // sometimes negative.
    assert_eq!(number("DAYS(DATE(2024,1,15),DATE(2024,1,1))"), 14.0);
    assert_eq!(number("DAYS(DATE(2024,1,1),DATE(2024,1,15))"), -14.0);
    assert_eq!(number("DAYS(DATE(2025,1,1),DATE(2024,1,1))"), 366.0);
    assert_eq!(number("DAYS(DATE(2024,1,1),DATE(2024,1,1))"), 0.0);
    assert_eq!(number("DATE(2024,1,15)-DATE(2024,1,1)"), 14.0);
}

#[test]
fn datedif_answers_in_whole_units_and_refuses_to_go_backwards() {
    assert_eq!(number("DATEDIF(DATE(2024,1,1),DATE(2025,1,1),\"Y\")"), 1.0);
    assert_eq!(
        number("DATEDIF(DATE(2024,1,1),DATE(2024,12,31),\"Y\")"),
        0.0
    );
    assert_eq!(number("DATEDIF(DATE(2024,1,1),DATE(2024,3,15),\"M\")"), 2.0);
    assert_eq!(
        number("DATEDIF(DATE(2024,1,1),DATE(2024,3,15),\"D\")"),
        74.0
    );
    assert_eq!(
        number("DATEDIF(DATE(2024,1,10),DATE(2024,3,15),\"MD\")"),
        5.0
    );
    assert_eq!(
        number("DATEDIF(DATE(2023,1,10),DATE(2024,4,15),\"YM\")"),
        3.0
    );
    assert_eq!(
        number("DATEDIF(DATE(2023,1,10),DATE(2024,3,15),\"YD\")"),
        65.0
    );
    assert_eq!(
        answer("DATEDIF(DATE(2024,3,1),DATE(2024,1,1),\"D\")"),
        Value::Error(Error::Number)
    );
}

#[test]
fn networkdays_leaves_out_the_weekends() {
    // The 1st of January 2024 was a Monday and the 5th a Friday.
    assert_eq!(number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,5))"), 5.0);
    assert_eq!(number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))"), 5.0);
    assert_eq!(number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,8))"), 6.0);
    assert_eq!(number("NETWORKDAYS(DATE(2024,1,6),DATE(2024,1,7))"), 0.0);
    // Both ends are counted, so one working day to itself is one day.
    assert_eq!(number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,1))"), 1.0);
    // Backwards is a negative count rather than a refusal.
    assert_eq!(number("NETWORKDAYS(DATE(2024,1,5),DATE(2024,1,1))"), -5.0);
}

#[test]
fn networkdays_leaves_out_the_holidays_it_is_given() {
    assert_eq!(
        number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,5),DATE(2024,1,1))"),
        4.0
    );
    assert_eq!(
        number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,5),{45292;45293})"),
        3.0
    );
    // A holiday that falls on a weekend was not a working day to begin with.
    assert_eq!(
        number("NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7),DATE(2024,1,6))"),
        5.0
    );
}

#[test]
fn the_international_kind_takes_a_weekend_of_its_own() {
    // 11 is "Sunday only", so the Saturday is worked.
    assert_eq!(
        number("NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),11)"),
        6.0
    );
    // 7 is Friday and Saturday, as a week is arranged in much of the world.
    assert_eq!(
        number("NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),7)"),
        5.0
    );
    // And the string says it a day at a time, beginning on Monday.
    assert_eq!(
        number("NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),\"0000011\")"),
        5.0
    );
    assert_eq!(
        number("NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),\"1000000\")"),
        6.0
    );
    assert_eq!(
        answer("NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),\"0000000\")"),
        Value::Error(Error::Value)
    );
}

#[test]
fn workday_counts_forward_over_the_weekends() {
    assert_eq!(
        number("WORKDAY(DATE(2024,1,1),1)"),
        number("DATE(2024,1,2)")
    );
    assert_eq!(
        number("WORKDAY(DATE(2024,1,1),5)"),
        number("DATE(2024,1,8)")
    );
    // Friday plus one working day is Monday.
    assert_eq!(
        number("WORKDAY(DATE(2024,1,5),1)"),
        number("DATE(2024,1,8)")
    );
    assert_eq!(
        number("WORKDAY(DATE(2024,1,8),-1)"),
        number("DATE(2024,1,5)")
    );
    assert_eq!(
        number("WORKDAY(DATE(2024,1,1),0)"),
        number("DATE(2024,1,1)")
    );
    // A holiday on the day it would have landed pushes it on again.
    assert_eq!(
        number("WORKDAY(DATE(2024,1,5),1,DATE(2024,1,8))"),
        number("DATE(2024,1,9)")
    );
    assert_eq!(
        number("WORKDAY.INTL(DATE(2024,1,5),1,11)"),
        number("DATE(2024,1,6)")
    );
}

#[test]
fn a_date_written_as_text_is_read_the_way_a_formula_is_read() {
    // English months and the American order for slashes: a formula is stored
    // in one language whatever the machine is set to, which is the same
    // reason the file says `TRUE` rather than a translation of it.
    assert_eq!(number("DATEVALUE(\"2024-01-15\")"), 45306.0);
    assert_eq!(number("DATEVALUE(\"1/15/2024\")"), 45306.0);
    assert_eq!(number("DATEVALUE(\"15-Jan-2024\")"), 45306.0);
    assert_eq!(number("DATEVALUE(\"January 15, 2024\")"), 45306.0);
    assert_eq!(number("DATEVALUE(\"15 January 2024\")"), 45306.0);
    // No time of day comes back with it.
    assert_eq!(number("DATEVALUE(\"2024-01-15\")").fract(), 0.0);
}

#[test]
fn text_that_names_no_day_is_refused() {
    assert_eq!(
        answer("DATEVALUE(\"not a date\")"),
        Value::Error(Error::Value)
    );
    assert_eq!(
        answer("DATEVALUE(\"2024-02-30\")"),
        Value::Error(Error::Value)
    );
    assert_eq!(
        answer("DATEVALUE(\"2024-13-01\")"),
        Value::Error(Error::Value)
    );
    assert_eq!(answer("DATEVALUE(\"\")"), Value::Error(Error::Value));
    assert_eq!(answer("TIMEVALUE(\"25:00\")"), Value::Error(Error::Value));
    assert_eq!(answer("TIMEVALUE(\"noon\")"), Value::Error(Error::Value));
}

#[test]
fn a_time_written_as_text_is_a_fraction_again() {
    assert_eq!(number("TIMEVALUE(\"12:00\")"), 0.5);
    assert_eq!(number("TIMEVALUE(\"6:00 PM\")"), 0.75);
    assert_eq!(number("TIMEVALUE(\"6:00 AM\")"), 0.25);
    // The one hour on the clock that does not mean what it says.
    assert_eq!(number("TIMEVALUE(\"12:00 AM\")"), 0.0);
    assert_eq!(number("TIMEVALUE(\"12:00 PM\")"), 0.5);
    close("TIMEVALUE(\"1:02:03\")", 3723.0 / 86_400.0);
}

#[test]
fn the_two_that_ask_what_time_it_is_are_told_by_the_caller() {
    // A pure library has no clock. `NOW` is worth what the workbook says,
    // which is what makes it a thing a test can ask twice.
    let sheet = Sheet::default().at_moment(45292.75);

    assert_eq!(on(&sheet, "NOW()"), Value::Number(45292.75));
    assert_eq!(on(&sheet, "TODAY()"), Value::Number(45292.0));
    assert_eq!(on(&sheet, "YEAR(TODAY())"), Value::Number(2024.0));
    assert_eq!(on(&sheet, "HOUR(NOW())"), Value::Number(18.0));
    assert_eq!(on(&sheet, "TODAY()+7"), Value::Number(45299.0));
}

#[test]
fn a_1904_workbook_counts_from_a_different_morning() {
    // Four years and a day fewer, and every date on the sheet moves with it.
    let sheet = Sheet::default().in_1904();

    assert_eq!(on(&sheet, "DATE(2024,1,1)"), Value::Number(43830.0));
    assert_eq!(on(&sheet, "YEAR(43830)"), Value::Number(2024.0));
    assert_eq!(on(&sheet, "DAY(43830)"), Value::Number(1.0));
    // The same day of the week, whichever morning the counting began.
    assert_eq!(on(&sheet, "WEEKDAY(DATE(2024,1,1))"), Value::Number(2.0));
    assert_eq!(on(&sheet, "DATE(1904,1,1)"), Value::Number(0.0));
}
