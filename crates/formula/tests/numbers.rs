//! Arithmetic and statistics, against Excel's answers.
//!
//! Two pairs here disagree with each other on purpose, because Excel does.
//! `CEILING(x,0)` is nought and `FLOOR(x,0)` is `#DIV/0!`; a sample's spread
//! divides by one fewer than a population's. Neither is tidied up: a reader
//! that tidied would disagree with the sheet it was given.

mod common;

use common::{on, Sheet};
use formula::value::{Error, Value};

/// The table the criteria functions are asked about.
fn table() -> Sheet {
    Sheet::with(&[
        ("A2", Value::Text("North".into())),
        ("B2", Value::Number(10.0)),
        ("A3", Value::Text("South".into())),
        ("B3", Value::Number(20.0)),
        ("A4", Value::Text("East".into())),
        ("B4", Value::Number(30.0)),
        ("A5", Value::Text("West".into())),
        ("B5", Value::Number(40.0)),
    ])
}

fn answer(formula: &str) -> Value {
    on(&table(), formula)
}

fn number(formula: &str) -> f64 {
    match answer(formula) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

fn close(formula: &str, expected: f64) {
    let found = number(formula);
    assert!(
        (found - expected).abs() < 1e-9,
        "{formula} is {found}, not {expected}"
    );
}

#[test]
fn ceiling_rounds_to_a_multiple_and_minds_the_signs() {
    assert_eq!(number("CEILING(2.5,1)"), 3.0);
    assert_eq!(number("CEILING(2.1,1)"), 3.0);
    close("CEILING(4.42,0.05)", 4.45);
    // A negative number with a positive step rounds towards zero; with a
    // negative step it rounds away from it.
    assert_eq!(number("CEILING(-2.5,1)"), -2.0);
    assert_eq!(number("CEILING(-2.5,-2)"), -4.0);
    // A step of nothing rounds to nothing.
    assert_eq!(number("CEILING(5,0)"), 0.0);
    assert_eq!(answer("CEILING(2.5,-1)"), Value::Error(Error::Number));
}

#[test]
fn floor_is_its_mirror_except_about_nought() {
    assert_eq!(number("FLOOR(2.5,1)"), 2.0);
    assert_eq!(number("FLOOR(2.9,1)"), 2.0);
    close("FLOOR(4.42,0.05)", 4.4);
    assert_eq!(number("FLOOR(-2.5,1)"), -3.0);
    assert_eq!(number("FLOOR(-2.5,-2)"), -2.0);
    // The pair have disagreed about a step of nothing since 1993.
    assert_eq!(answer("FLOOR(5,0)"), Value::Error(Error::DivideByZero));
    assert_eq!(answer("FLOOR(2.5,-1)"), Value::Error(Error::Number));
}

#[test]
fn sumproduct_multiplies_down_the_rows_and_adds_them_up() {
    assert_eq!(number("SUMPRODUCT({1,2,3},{4,5,6})"), 32.0);
    assert_eq!(number("SUMPRODUCT(B2:B5)"), 100.0);
    assert_eq!(number("SUMPRODUCT({1,2},{3,4},{5,6})"), 63.0);
    // A word among the numbers counts as nought rather than stopping it: a
    // column with a heading over it is the ordinary case.
    assert_eq!(number("SUMPRODUCT(A2:A5,B2:B5)"), 0.0);
    // Lined up by position, so different shapes have no answer at all.
    assert_eq!(
        answer("SUMPRODUCT({1,2,3},{4,5})"),
        Value::Error(Error::Value)
    );
    assert_eq!(number("SUMSQ(3,4)"), 25.0);
}

#[test]
fn the_ifs_family_asks_every_criterion_of_the_same_row() {
    assert_eq!(number("SUMIFS(B2:B5,A2:A5,\"North\")"), 10.0);
    assert_eq!(number("SUMIFS(B2:B5,B2:B5,\">15\")"), 90.0);
    assert_eq!(number("SUMIFS(B2:B5,B2:B5,\">15\",B2:B5,\"<40\")"), 50.0);
    assert_eq!(number("COUNTIFS(A2:A5,\"*st\")"), 2.0);
    assert_eq!(number("COUNTIFS(B2:B5,\">15\",A2:A5,\"East\")"), 1.0);
    assert_eq!(number("AVERAGEIFS(B2:B5,B2:B5,\">15\")"), 30.0);
    assert_eq!(number("COUNTIFS(A2:A5,\"Nowhere\")"), 0.0);
    // Nothing matching has no average, as it has none anywhere else.
    assert_eq!(
        answer("AVERAGEIFS(B2:B5,A2:A5,\"Nowhere\")"),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn a_criterion_without_a_range_is_a_formula_somebody_is_still_writing() {
    assert_eq!(
        answer("COUNTIFS(A2:A5,\"North\",B2:B5)"),
        Value::Error(Error::Value)
    );
    // And ranges of different shapes are lined up against the wrong rows.
    assert_eq!(
        answer("COUNTIFS(A2:A5,\"North\",B2:B4,\">1\")"),
        Value::Error(Error::Value)
    );
    assert_eq!(
        answer("SUMIFS(B2:B5,A2:A4,\"North\")"),
        Value::Error(Error::Value)
    );
}

#[test]
fn mode_is_the_one_that_happens_most_and_says_so_when_none_does() {
    assert_eq!(number("MODE({1,2,2,3})"), 2.0);
    assert_eq!(number("MODE.SNGL({1,2,2,3,3,3})"), 3.0);
    // A tie goes to whichever came first.
    assert_eq!(number("MODE({4,4,5,5})"), 4.0);
    assert_eq!(number("MODE({1,1})"), 1.0);
    // Everything happening once has no most-common thing.
    assert_eq!(answer("MODE({1,2,3})"), Value::Error(Error::NotAvailable));
}

#[test]
fn a_sample_divides_by_one_fewer_than_a_population() {
    // Because it is standing in for something larger. A table of every branch
    // there is divides by all of them.
    close("VAR.S({1,2,3,4})", 5.0 / 3.0);
    assert_eq!(number("VAR.P({1,2,3,4})"), 1.25);
    assert_eq!(number("VAR({1,2,3,4})"), number("VAR.S({1,2,3,4})"));
    assert_eq!(number("VARP({1,2,3,4})"), number("VAR.P({1,2,3,4})"));
    close("STDEV.S({1,2,3,4})", (5.0_f64 / 3.0).sqrt());
    close("STDEV.P({1,2,3,4})", 1.25_f64.sqrt());
    assert_eq!(number("STDEV({1,2,3,4})"), number("STDEV.S({1,2,3,4})"));
    // One number is no sample at all.
    assert_eq!(answer("VAR.S({1})"), Value::Error(Error::DivideByZero));
    assert_eq!(number("VAR.P({1})"), 0.0);
}

#[test]
fn rank_counts_from_the_top_unless_asked_otherwise() {
    assert_eq!(number("RANK(30,B2:B5)"), 2.0);
    assert_eq!(number("RANK(40,B2:B5)"), 1.0);
    assert_eq!(number("RANK(30,B2:B5,1)"), 3.0);
    assert_eq!(number("RANK.EQ(10,B2:B5)"), 4.0);
    assert_eq!(answer("RANK(25,B2:B5)"), Value::Error(Error::NotAvailable));
    // Two in second place are both second; the average kind splits it.
    assert_eq!(number("RANK.EQ(2,{3,2,2,1})"), 2.0);
    assert_eq!(number("RANK.AVG(2,{3,2,2,1})"), 2.5);
}

#[test]
fn large_and_small_count_in_from_the_ends() {
    assert_eq!(number("LARGE(B2:B5,1)"), 40.0);
    assert_eq!(number("LARGE(B2:B5,2)"), 30.0);
    assert_eq!(number("SMALL(B2:B5,1)"), 10.0);
    assert_eq!(number("SMALL(B2:B5,4)"), 40.0);
    assert_eq!(answer("LARGE(B2:B5,5)"), Value::Error(Error::Number));
    assert_eq!(answer("SMALL(B2:B5,0)"), Value::Error(Error::Number));
}

#[test]
fn a_percentile_is_interpolated_rather_than_rounded_to_one_of_them() {
    // The median of an even list is the average of the middle pair, and a
    // percentile is that same idea at any other fraction.
    assert_eq!(number("PERCENTILE({1,2,3,4},0.5)"), 2.5);
    assert_eq!(number("PERCENTILE.INC({1,2,3,4},0.25)"), 1.75);
    assert_eq!(number("PERCENTILE.INC({1,2,3,4},0)"), 1.0);
    assert_eq!(number("PERCENTILE.INC({1,2,3,4},1)"), 4.0);
    assert_eq!(
        answer("PERCENTILE.INC({1,2,3,4},1.5)"),
        Value::Error(Error::Number)
    );
}

#[test]
fn the_exclusive_kind_will_not_answer_about_the_ends() {
    // It holds that four numbers say nothing about the tenth percentile of
    // whatever they were drawn from, and refuses rather than extrapolating.
    assert_eq!(number("PERCENTILE.EXC({1,2,3,4},0.5)"), 2.5);
    assert_eq!(
        answer("PERCENTILE.EXC({1,2,3,4},0.1)"),
        Value::Error(Error::Number)
    );
    assert_eq!(
        answer("PERCENTILE.EXC({1,2,3,4},0.9)"),
        Value::Error(Error::Number)
    );
}

#[test]
fn a_quartile_is_a_percentile_counted_in_quarters() {
    assert_eq!(number("QUARTILE({1,2,3,4},0)"), 1.0);
    assert_eq!(number("QUARTILE({1,2,3,4},1)"), 1.75);
    assert_eq!(number("QUARTILE({1,2,3,4},2)"), 2.5);
    assert_eq!(number("QUARTILE.INC({1,2,3,4},4)"), 4.0);
    assert_eq!(answer("QUARTILE({1,2,3,4},5)"), Value::Error(Error::Number));
    // The exclusive kind has no nought-th or fourth quarter to give.
    assert_eq!(number("QUARTILE.EXC({1,2,3,4},2)"), 2.5);
    assert_eq!(
        answer("QUARTILE.EXC({1,2,3,4},0)"),
        Value::Error(Error::Number)
    );
}

#[test]
fn correl_is_one_when_they_move_together_and_minus_one_when_they_do_not() {
    assert_eq!(number("CORREL({1,2,3},{2,4,6})"), 1.0);
    assert_eq!(number("CORREL({1,2,3},{3,2,1})"), -1.0);
    close("CORREL({1,2,3,4},{1,3,2,4})", 0.8);
    // A column that never changes has nothing for the other to move with.
    assert_eq!(
        answer("CORREL({1,1,1},{1,2,3})"),
        Value::Error(Error::DivideByZero)
    );
    assert_eq!(
        answer("CORREL({1,2,3},{1,2})"),
        Value::Error(Error::NotAvailable)
    );
}

#[test]
fn forecast_reads_the_straight_line_at_one_more_x() {
    assert_eq!(number("FORECAST(4,{2,4,6},{1,2,3})"), 8.0);
    assert_eq!(number("FORECAST.LINEAR(4,{2,4,6},{1,2,3})"), 8.0);
    assert_eq!(number("FORECAST(0,{2,4,6},{1,2,3})"), 0.0);
    close("FORECAST(2.5,{2,4,6},{1,2,3})", 5.0);
    assert_eq!(
        answer("FORECAST(4,{2,4,6},{1,1,1})"),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn the_random_pair_are_told_what_chance_gave() {
    // A library that made its own randomness could not be asked twice and
    // answer the same way, which is no way to test the one function whose
    // whole purpose is to be unpredictable.
    let sheet = Sheet::default().with_random(0.25);

    assert_eq!(on(&sheet, "RAND()"), Value::Number(0.25));
    assert_eq!(on(&sheet, "RANDBETWEEN(1,6)"), Value::Number(2.0));
    assert_eq!(on(&sheet, "RANDBETWEEN(0,0)"), Value::Number(0.0));
    assert_eq!(on(&sheet, "RANDBETWEEN(10,10)"), Value::Number(10.0));
    assert_eq!(on(&sheet, "RANDBETWEEN(6,1)"), Value::Error(Error::Number));

    // Both ends are included: a die that never shows a six is not a die.
    let almost = Sheet::default().with_random(0.999_999);
    assert_eq!(on(&almost, "RANDBETWEEN(1,6)"), Value::Number(6.0));
}
