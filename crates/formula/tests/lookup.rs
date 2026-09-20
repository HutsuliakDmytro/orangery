//! Finding a value somewhere else, and asking what a value is.
//!
//! Every expected answer here is Excel's. The ones worth reading twice are
//! the defaults nobody remembers: `VLOOKUP` without a fourth argument looks
//! for the nearest match rather than the exact one, `MATCH` without a third
//! does the same, and a criterion that compares — `">5"` — passes over the
//! empty cells and the words instead of counting them.

mod common;

use common::{on, on_cell, Sheet};
use formula::value::{Error, Value};

/// The table people actually have: a heading, a column of words, a column of
/// numbers, and a lookup table of brackets beside it.
fn table() -> Sheet {
    Sheet::with(&[
        ("A1", Value::Text("Region".into())),
        ("B1", Value::Text("Amount".into())),
        ("C1", Value::Text("Code".into())),
        ("A2", Value::Text("North".into())),
        ("B2", Value::Number(10.0)),
        ("C2", Value::Text("x".into())),
        ("A3", Value::Text("South".into())),
        ("B3", Value::Number(20.0)),
        ("C3", Value::Text("y".into())),
        ("A4", Value::Text("East".into())),
        ("B4", Value::Number(30.0)),
        ("C4", Value::Text("z".into())),
        ("A5", Value::Text("West".into())),
        ("B5", Value::Number(40.0)),
        ("C5", Value::Text("w".into())),
        // Brackets, sorted, as an approximate lookup needs them.
        ("E1", Value::Number(0.0)),
        ("F1", Value::Text("low".into())),
        ("E2", Value::Number(100.0)),
        ("F2", Value::Text("mid".into())),
        ("E3", Value::Number(200.0)),
        ("F3", Value::Text("high".into())),
        // The same shape lying on its side, for `HLOOKUP`.
        ("A8", Value::Text("Jan".into())),
        ("B8", Value::Text("Feb".into())),
        ("C8", Value::Text("Mar".into())),
        ("A9", Value::Number(1.0)),
        ("B9", Value::Number(2.0)),
        ("C9", Value::Number(3.0)),
        ("A10", Value::Number(10.0)),
        ("B10", Value::Number(20.0)),
        ("C10", Value::Number(30.0)),
        ("A12", Value::Number(0.0)),
        ("B12", Value::Number(100.0)),
        ("C12", Value::Number(200.0)),
        ("A13", Value::Text("low".into())),
        ("B13", Value::Text("mid".into())),
        ("C13", Value::Text("high".into())),
        // A column with a hole in it, which is what a column usually is.
        ("H1", Value::Number(1.0)),
        ("H3", Value::Number(5.0)),
    ])
}

fn answer(formula: &str) -> Value {
    on(&table(), formula)
}

#[test]
fn vlookup_asked_for_an_exact_match_gives_one_or_says_it_is_not_there() {
    assert_eq!(
        answer("VLOOKUP(\"South\",A2:C5,2,FALSE)"),
        Value::Number(20.0)
    );
    assert_eq!(
        answer("VLOOKUP(\"South\",A2:C5,3,FALSE)"),
        Value::Text("y".into())
    );
    // Words compare without case here as they do everywhere else.
    assert_eq!(
        answer("VLOOKUP(\"south\",A2:C5,2,FALSE)"),
        Value::Number(20.0)
    );
    assert_eq!(
        answer("VLOOKUP(\"Nowhere\",A2:C5,2,FALSE)"),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(
        answer("VLOOKUP(\"West\",A2:C5,1,FALSE)"),
        Value::Text("West".into())
    );
}

#[test]
fn vlookup_left_to_itself_looks_for_the_nearest_below() {
    // The default that catches everybody: no fourth argument means the last
    // row that is not larger, which is what makes a bracket table work and an
    // unsorted column answer wrongly in silence.
    assert_eq!(answer("VLOOKUP(150,E1:F3,2)"), Value::Text("mid".into()));
    assert_eq!(answer("VLOOKUP(100,E1:F3,2)"), Value::Text("mid".into()));
    assert_eq!(answer("VLOOKUP(0,E1:F3,2)"), Value::Text("low".into()));
    assert_eq!(answer("VLOOKUP(500,E1:F3,2)"), Value::Text("high".into()));
    // Below the first bracket there is nothing to fall back to.
    assert_eq!(
        answer("VLOOKUP(-1,E1:F3,2)"),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(
        answer("VLOOKUP(150,E1:F3,2,TRUE)"),
        Value::Text("mid".into())
    );
}

#[test]
fn vlookup_asked_for_a_column_the_table_has_not_got_says_ref() {
    // Not `#N/A`: the row was found, the column was never there, and the two
    // are different mistakes to make.
    assert_eq!(
        answer("VLOOKUP(\"North\",A2:C5,4,FALSE)"),
        Value::Error(Error::Reference)
    );
    assert_eq!(
        answer("VLOOKUP(\"North\",A2:C5,0,FALSE)"),
        Value::Error(Error::Reference)
    );
    assert_eq!(
        answer("VLOOKUP(\"North\",A2:C5,-1,FALSE)"),
        Value::Error(Error::Reference)
    );
    assert_eq!(
        answer("VLOOKUP(\"North\",A2:C5,3,FALSE)"),
        Value::Text("x".into())
    );
    assert_eq!(
        answer("VLOOKUP(\"North\",A2:A5,1,FALSE)"),
        Value::Text("North".into())
    );
}

#[test]
fn a_lookup_for_something_broken_hands_the_breakage_back() {
    let sheet = Sheet::with(&[("A1", Value::Error(Error::DivideByZero))]);
    assert_eq!(
        on(&sheet, "VLOOKUP(A1,A1:B2,2,FALSE)"),
        Value::Error(Error::DivideByZero)
    );
    assert_eq!(
        on(&sheet, "HLOOKUP(A1,A1:B2,2,FALSE)"),
        Value::Error(Error::DivideByZero)
    );
    assert_eq!(
        on(&sheet, "MATCH(A1,A1:A2,0)"),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn hlookup_is_the_same_question_asked_sideways() {
    assert_eq!(
        answer("HLOOKUP(\"Feb\",A8:C10,2,FALSE)"),
        Value::Number(2.0)
    );
    assert_eq!(
        answer("HLOOKUP(\"Mar\",A8:C10,3,FALSE)"),
        Value::Number(30.0)
    );
    assert_eq!(
        answer("HLOOKUP(\"Jan\",A8:C10,1,FALSE)"),
        Value::Text("Jan".into())
    );
    assert_eq!(
        answer("HLOOKUP(\"Apr\",A8:C10,2,FALSE)"),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(
        answer("HLOOKUP(\"Jan\",A8:C10,4,FALSE)"),
        Value::Error(Error::Reference)
    );
    assert_eq!(answer("HLOOKUP(150,A12:C13,2)"), Value::Text("mid".into()));
}

#[test]
fn index_counts_from_one_in_both_directions() {
    assert_eq!(answer("INDEX(A2:C5,2,2)"), Value::Number(20.0));
    assert_eq!(answer("INDEX(A2:C5,4,1)"), Value::Text("West".into()));
    assert_eq!(answer("INDEX(A2:C5,1,3)"), Value::Text("x".into()));
    // A single column or a single row is indexed by the one number.
    assert_eq!(answer("INDEX(A2:A5,3)"), Value::Text("East".into()));
    assert_eq!(answer("INDEX(A8:C8,2)"), Value::Text("Feb".into()));
    assert_eq!(answer("INDEX(A2:C5,9,1)"), Value::Error(Error::Reference));
}

#[test]
fn index_with_a_nought_is_the_whole_row_or_the_whole_column() {
    // Which is what makes `SUM(INDEX(table,0,2))` a column total.
    assert_eq!(answer("SUM(INDEX(A2:C5,0,2))"), Value::Number(100.0));
    assert_eq!(answer("SUM(INDEX(A9:C10,2,0))"), Value::Number(60.0));
    assert_eq!(answer("COLUMNS(INDEX(A2:C5,0,2))"), Value::Number(1.0));
    assert_eq!(answer("ROWS(INDEX(A2:C5,0,2))"), Value::Number(4.0));
    assert_eq!(answer("ROWS(INDEX(A2:C5,0,0))"), Value::Number(4.0));
}

#[test]
fn match_gives_the_place_rather_than_the_value() {
    assert_eq!(answer("MATCH(\"East\",A2:A5,0)"), Value::Number(3.0));
    assert_eq!(answer("MATCH(\"east\",A2:A5,0)"), Value::Number(3.0));
    assert_eq!(answer("MATCH(30,B2:B5,0)"), Value::Number(3.0));
    assert_eq!(
        answer("MATCH(\"Nowhere\",A2:A5,0)"),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(answer("MATCH(20,{10;20;30},0)"), Value::Number(2.0));
}

#[test]
fn match_without_a_third_argument_looks_for_the_nearest_below() {
    assert_eq!(answer("MATCH(150,E1:E3)"), Value::Number(2.0));
    assert_eq!(answer("MATCH(150,E1:E3,1)"), Value::Number(2.0));
    assert_eq!(answer("MATCH(200,E1:E3,1)"), Value::Number(3.0));
    assert_eq!(
        answer("MATCH(-1,E1:E3,1)"),
        Value::Error(Error::NotAvailable)
    );
    // -1 wants the list the other way up: the smallest that is not smaller.
    assert_eq!(answer("MATCH(15,{30;20;10},-1)"), Value::Number(2.0));
}

#[test]
fn choose_counts_from_one_and_does_not_count_itself() {
    assert_eq!(
        answer("CHOOSE(2,\"a\",\"b\",\"c\")"),
        Value::Text("b".into())
    );
    assert_eq!(answer("CHOOSE(1,10,20)"), Value::Number(10.0));
    // A nought would land on the selector; Excel says the argument is wrong.
    assert_eq!(answer("CHOOSE(0,10,20)"), Value::Error(Error::Value));
    assert_eq!(answer("CHOOSE(3,10,20)"), Value::Error(Error::Value));
    // The index is truncated rather than rounded.
    assert_eq!(answer("CHOOSE(2.9,\"a\",\"b\")"), Value::Text("b".into()));
}

#[test]
fn row_and_column_answer_about_where_rather_than_what() {
    let sheet = table();

    // No argument is the cell the formula is written in, which is how a
    // numbered column is made.
    assert_eq!(on_cell(&sheet, "ROW()", (2, 1)), Value::Number(3.0));
    assert_eq!(on_cell(&sheet, "COLUMN()", (2, 1)), Value::Number(2.0));
    assert_eq!(answer("ROW(A5)"), Value::Number(5.0));
    assert_eq!(answer("COLUMN(C1)"), Value::Number(3.0));
    // A range answers about its top left corner.
    assert_eq!(answer("ROW(B2:D9)"), Value::Number(2.0));
    assert_eq!(answer("COLUMN(B2:D9)"), Value::Number(2.0));
    assert_eq!(answer("ROW(\"x\")"), Value::Error(Error::Value));
}

#[test]
fn rows_and_columns_measure_the_rectangle() {
    assert_eq!(answer("ROWS(A2:C5)"), Value::Number(4.0));
    assert_eq!(answer("COLUMNS(A2:C5)"), Value::Number(3.0));
    // One cell is a rectangle of one.
    assert_eq!(answer("ROWS(A1)"), Value::Number(1.0));
    assert_eq!(answer("COLUMNS(A1)"), Value::Number(1.0));
    assert_eq!(answer("ROWS({1,2,3})"), Value::Number(1.0));
    assert_eq!(answer("COLUMNS({1,2,3})"), Value::Number(3.0));
    assert_eq!(answer("ROWS({1;2})"), Value::Number(2.0));
}

#[test]
fn sumif_adds_the_rows_that_answer_the_criterion() {
    assert_eq!(answer("SUMIF(A2:A5,\"South\",B2:B5)"), Value::Number(20.0));
    assert_eq!(answer("SUMIF(B2:B5,\">15\")"), Value::Number(90.0));
    assert_eq!(answer("SUMIF(B2:B5,\">15\",B2:B5)"), Value::Number(90.0));
    assert_eq!(answer("SUMIF(B2:B5,\"<=20\")"), Value::Number(30.0));
    // Nothing matching is nought, not an error: a total of no rows is nought.
    assert_eq!(answer("SUMIF(A2:A5,\"Nowhere\",B2:B5)"), Value::Number(0.0));
    assert_eq!(answer("SUMIF(A2:A5,\"*th\",B2:B5)"), Value::Number(30.0));
}

#[test]
fn countif_counts_them_instead() {
    assert_eq!(answer("COUNTIF(A2:A5,\"North\")"), Value::Number(1.0));
    assert_eq!(answer("COUNTIF(B2:B5,\">=20\")"), Value::Number(3.0));
    assert_eq!(answer("COUNTIF(B2:B5,\"<>20\")"), Value::Number(3.0));
    assert_eq!(answer("COUNTIF(B2:B5,40)"), Value::Number(1.0));
    // A number written as a criterion is still a number.
    assert_eq!(answer("COUNTIF(B2:B5,\"40\")"), Value::Number(1.0));
    assert_eq!(answer("COUNTIF(A2:A5,\"Nowhere\")"), Value::Number(0.0));
}

#[test]
fn a_criterion_takes_the_wildcards_people_write() {
    // `*` for anything and `?` for one letter, which is what makes
    // `COUNTIF(A:A,"north*")` the thing people reach for.
    assert_eq!(answer("COUNTIF(A2:A5,\"*st\")"), Value::Number(2.0));
    assert_eq!(answer("COUNTIF(A2:A5,\"????\")"), Value::Number(2.0));
    assert_eq!(answer("COUNTIF(A2:A5,\"?????\")"), Value::Number(2.0));
    assert_eq!(answer("COUNTIF(A2:A5,\"nor*\")"), Value::Number(1.0));
    assert_eq!(answer("COUNTIF(A2:A5,\"*\")"), Value::Number(4.0));
    assert_eq!(answer("SUMIF(A2:A5,\"*st\",B2:B5)"), Value::Number(70.0));
}

#[test]
fn a_comparison_passes_over_the_empty_cells() {
    // Otherwise `COUNTIF(A:A,"<5")` would be a count of the million cells
    // that are not there.
    assert_eq!(answer("COUNTIF(H1:H3,\"<10\")"), Value::Number(2.0));
    assert_eq!(answer("COUNTIF(H1:H3,\">0\")"), Value::Number(2.0));
    assert_eq!(answer("SUMIF(H1:H3,\"<10\")"), Value::Number(6.0));
    // The one criterion an empty cell does answer is the one asking for one.
    assert_eq!(answer("COUNTIF(H1:H3,\"\")"), Value::Number(1.0));
    assert_eq!(answer("COUNTIF(H1:H3,\"<>\")"), Value::Number(2.0));
}

#[test]
fn a_comparison_passes_over_the_words_as_well() {
    // The kinds of value do have an order — it is what sorting is built on —
    // but a region is not "greater than 15".
    assert_eq!(answer("COUNTIF(A2:A5,\">15\")"), Value::Number(0.0));
    assert_eq!(answer("SUMIF(A2:A5,\">15\",B2:B5)"), Value::Number(0.0));
    assert_eq!(answer("COUNTIF(B2:B5,\">a\")"), Value::Number(0.0));
    assert_eq!(answer("COUNTIF(A2:A5,\">=North\")"), Value::Number(3.0));
    assert_eq!(answer("COUNTIF(A2:A5,\"<>15\")"), Value::Number(4.0));
}

#[test]
fn averageif_is_the_sum_over_the_count_and_says_so_when_there_is_none() {
    assert_eq!(answer("AVERAGEIF(B2:B5,\">15\")"), Value::Number(30.0));
    assert_eq!(answer("AVERAGEIF(B2:B5,\">0\")"), Value::Number(25.0));
    assert_eq!(answer("AVERAGEIF(B2:B5,\">=30\")"), Value::Number(35.0));
    assert_eq!(
        answer("AVERAGEIF(A2:A5,\"North\",B2:B5)"),
        Value::Number(10.0)
    );
    // No rows at all is `#DIV/0!`, as an average of nothing is everywhere.
    assert_eq!(
        answer("AVERAGEIF(A2:A5,\"Nowhere\",B2:B5)"),
        Value::Error(Error::DivideByZero)
    );
}

/// A cell of each kind, which is what the questions are asked about.
fn kinds() -> Sheet {
    Sheet::with(&[
        ("A2", Value::Number(5.0)),
        ("A3", Value::Text("text".into())),
        ("A4", Value::Bool(true)),
        ("A5", Value::Error(Error::DivideByZero)),
        ("A6", Value::Error(Error::NotAvailable)),
    ])
}

#[test]
fn isblank_is_about_the_cell_and_not_about_what_it_shows() {
    let sheet = kinds();

    assert_eq!(on(&sheet, "ISBLANK(A1)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISBLANK(A2)"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISBLANK(A3)"), Value::Bool(false));
    // A cell holding "" is not a cell holding nothing, which is the whole
    // difference between the two ways of filtering a column.
    assert_eq!(on(&sheet, "ISBLANK(\"\")"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISBLANK(A5)"), Value::Bool(false));
}

#[test]
fn isnumber_and_istext_ask_what_kind_rather_than_what_it_looks_like() {
    let sheet = kinds();

    assert_eq!(on(&sheet, "ISNUMBER(A2)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISNUMBER(1/2)"), Value::Bool(true));
    // A number that arrived as text is text, which is why a column from a
    // text file will not add up.
    assert_eq!(on(&sheet, "ISNUMBER(\"5\")"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISNUMBER(A1)"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISTEXT(A3)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISTEXT(A2)"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISTEXT(A1)"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISLOGICAL(A4)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISLOGICAL(1)"), Value::Bool(false));
}

#[test]
fn the_error_questions_tell_not_found_apart_from_broken() {
    let sheet = kinds();

    assert_eq!(on(&sheet, "ISERROR(A5)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISERROR(A6)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISERROR(A2)"), Value::Bool(false));
    // `ISERR` leaves out `#N/A`, because a lookup that found nothing is not
    // a formula that went wrong.
    assert_eq!(on(&sheet, "ISERR(A5)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISERR(A6)"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISNA(A6)"), Value::Bool(true));
    assert_eq!(on(&sheet, "ISNA(A5)"), Value::Bool(false));
    assert_eq!(on(&sheet, "ISNA(NA())"), Value::Bool(true));
    assert_eq!(on(&sheet, "NA()"), Value::Error(Error::NotAvailable));
}

#[test]
fn n_and_t_are_the_polite_way_to_ask_for_one_kind() {
    let sheet = kinds();

    assert_eq!(on(&sheet, "N(5)"), Value::Number(5.0));
    assert_eq!(on(&sheet, "N(A4)"), Value::Number(1.0));
    assert_eq!(on(&sheet, "N(A1)"), Value::Number(0.0));
    // Text is nought rather than `#VALUE!`, which is what `N` is for.
    assert_eq!(on(&sheet, "N(A3)"), Value::Number(0.0));
    assert_eq!(on(&sheet, "N(A5)"), Value::Error(Error::DivideByZero));

    assert_eq!(on(&sheet, "T(A3)"), Value::Text("text".into()));
    assert_eq!(on(&sheet, "T(5)"), Value::Text(String::new()));
    assert_eq!(on(&sheet, "T(A4)"), Value::Text(String::new()));
    assert_eq!(on(&sheet, "T(A1)"), Value::Text(String::new()));
    assert_eq!(on(&sheet, "T(A6)"), Value::Error(Error::NotAvailable));
}

#[test]
fn type_answers_in_excels_numbering() {
    let sheet = kinds();

    assert_eq!(on(&sheet, "TYPE(A2)"), Value::Number(1.0));
    // An empty cell is a number's kind to `TYPE`, as it is to arithmetic.
    assert_eq!(on(&sheet, "TYPE(A1)"), Value::Number(1.0));
    assert_eq!(on(&sheet, "TYPE(A3)"), Value::Number(2.0));
    assert_eq!(on(&sheet, "TYPE(A4)"), Value::Number(4.0));
    assert_eq!(on(&sheet, "TYPE(A5)"), Value::Number(16.0));
    assert_eq!(on(&sheet, "TYPE({1,2})"), Value::Number(64.0));
}
