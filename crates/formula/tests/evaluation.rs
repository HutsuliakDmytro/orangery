//! Working a formula out.
//!
//! Every expected value here is what Excel shows for the same formula, which
//! is the bar the plan sets. The cases worth having are the ones where a
//! language would answer differently: `"5"+1`, `TRUE+1`, `1<"a"`, a division
//! by nothing, and `=0.1+0.2-0.3`, which is nought in a spreadsheet and is
//! not in any other calculator anybody has.

use std::collections::HashMap;

use formula::eval::{evaluate, Cells, Context};
use formula::parser::parse;
use formula::value::{Error, Value};

/// A handful of cells in a map, which is all the evaluator needs of a sheet.
#[derive(Default)]
struct Sheet {
    cells: HashMap<(Option<String>, i64, i64), Value>,
    extent: (i64, i64),
}

impl Sheet {
    fn with(cells: &[(&str, Value)]) -> Self {
        let mut sheet = Sheet {
            cells: HashMap::new(),
            extent: (10, 10),
        };

        for (at, value) in cells {
            let (sheet_name, reference) = match at.split_once('!') {
                Some((name, cell)) => (Some(name.to_string()), cell),
                None => (None, *at),
            };

            let (row, column) = address(reference);
            sheet.cells.insert((sheet_name, row, column), value.clone());
        }

        sheet
    }
}

/// `B7` as a row and a column, for writing the fixtures readably.
fn address(reference: &str) -> (i64, i64) {
    let letters: String = reference
        .chars()
        .take_while(char::is_ascii_alphabetic)
        .collect();
    let digits: String = reference.chars().skip(letters.len()).collect();

    let mut column: i64 = 0;
    for letter in letters.chars() {
        column = column * 26 + (letter.to_ascii_uppercase() as i64 - 'A' as i64) + 1;
    }

    (digits.parse::<i64>().unwrap_or(1) - 1, column - 1)
}

impl Cells for Sheet {
    fn value_at(&self, sheet: Option<&str>, row: i64, column: i64) -> Value {
        self.cells
            .get(&(sheet.map(str::to_string), row, column))
            .cloned()
            .unwrap_or(Value::Blank)
    }

    fn extent(&self, _sheet: Option<&str>) -> (i64, i64) {
        self.extent
    }
}

fn worked_out(formula: &str, sheet: &Sheet) -> Value {
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(
        &tree,
        &Context {
            cells: sheet,
            at: (0, 0),
        },
    )
}

fn number(formula: &str) -> f64 {
    match worked_out(formula, &Sheet::default()) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

#[test]
fn arithmetic_is_arithmetic() {
    assert_eq!(number("1+2"), 3.0);
    assert_eq!(number("2*3+4"), 10.0);
    assert_eq!(number("2+3*4"), 14.0);
    assert_eq!(number("(2+3)*4"), 20.0);
    assert_eq!(number("2^3^2"), 64.0);
}

#[test]
fn a_minus_in_front_binds_tighter_than_the_power() {
    // -2^2 is 4 in Excel, where the minus is part of the number.
    assert_eq!(number("-2^2"), 4.0);
}

#[test]
fn a_percentage_divides_by_a_hundred() {
    assert_eq!(number("50%"), 0.5);
    assert_eq!(number("200*50%"), 100.0);
}

#[test]
fn dividing_by_nothing_is_an_error_rather_than_infinity() {
    assert_eq!(
        worked_out("1/0", &Sheet::default()),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn a_number_written_as_text_is_still_a_number_to_arithmetic() {
    assert_eq!(number("\"5\"+1"), 6.0);
    assert_eq!(number("\"1.5\"*2"), 3.0);
}

#[test]
fn a_word_is_not() {
    assert_eq!(
        worked_out("\"five\"+1", &Sheet::default()),
        Value::Error(Error::Value)
    );
}

#[test]
fn a_boolean_is_one_or_nothing_to_arithmetic() {
    assert_eq!(number("TRUE+1"), 2.0);
    assert_eq!(number("FALSE+1"), 1.0);
}

#[test]
fn text_is_joined_by_the_ampersand_whatever_it_was() {
    let sheet = Sheet::default();

    assert_eq!(
        worked_out("\"a\"&\"b\"", &sheet),
        Value::Text("ab".to_string())
    );
    assert_eq!(worked_out("1&2", &sheet), Value::Text("12".to_string()));
    assert_eq!(
        worked_out("TRUE&\"!\"", &sheet),
        Value::Text("TRUE!".to_string())
    );
}

#[test]
fn an_empty_cell_is_nothing_to_arithmetic_and_nothing_to_text() {
    let sheet = Sheet::default();

    assert_eq!(worked_out("A1+1", &sheet), Value::Number(1.0));
    assert_eq!(worked_out("A1&\"x\"", &sheet), Value::Text("x".to_string()));
}

#[test]
fn comparisons_answer_with_the_two_words() {
    let sheet = Sheet::default();

    assert_eq!(worked_out("1<2", &sheet), Value::Bool(true));
    assert_eq!(worked_out("2<=2", &sheet), Value::Bool(true));
    assert_eq!(worked_out("1<>1", &sheet), Value::Bool(false));
}

#[test]
fn text_compares_without_case_because_a_spreadsheet_does() {
    assert_eq!(
        worked_out("\"a\"=\"A\"", &Sheet::default()),
        Value::Bool(true)
    );
}

#[test]
fn every_number_is_less_than_every_word() {
    // Which looks wrong until you know it, and is what sorting depends on.
    let sheet = Sheet::default();

    assert_eq!(worked_out("1<\"a\"", &sheet), Value::Bool(true));
    assert_eq!(worked_out("\"a\"<TRUE", &sheet), Value::Bool(true));
}

#[test]
fn a_reference_is_what_is_in_the_cell() {
    let sheet = Sheet::with(&[("A1", Value::Number(7.0)), ("B2", Value::Text("hi".into()))]);

    assert_eq!(worked_out("A1", &sheet), Value::Number(7.0));
    assert_eq!(worked_out("A1*2", &sheet), Value::Number(14.0));
    assert_eq!(
        worked_out("B2&\"!\"", &sheet),
        Value::Text("hi!".to_string())
    );
}

#[test]
fn a_reference_can_name_another_sheet() {
    let sheet = Sheet::with(&[("Notes!A1", Value::Number(3.0))]);
    assert_eq!(worked_out("Notes!A1+1", &sheet), Value::Number(4.0));
}

#[test]
fn a_range_of_one_cell_is_that_cell() {
    let sheet = Sheet::with(&[("A1", Value::Number(5.0))]);
    assert_eq!(worked_out("A1:A1", &sheet), Value::Number(5.0));
}

#[test]
fn a_range_of_several_is_the_rectangle_it_names() {
    let sheet = Sheet::with(&[
        ("A1", Value::Number(1.0)),
        ("A2", Value::Number(2.0)),
        ("B1", Value::Number(3.0)),
        ("B2", Value::Number(4.0)),
    ]);

    let Value::Array(array) = worked_out("A1:B2", &sheet) else {
        panic!("not an array")
    };

    assert_eq!((array.rows, array.columns), (2, 2));
    assert_eq!(array.at(1, 1), &Value::Number(4.0));
}

#[test]
fn an_error_in_a_cell_travels_through_the_formula() {
    let sheet = Sheet::with(&[("A1", Value::Error(Error::NotAvailable))]);

    assert_eq!(
        worked_out("A1+1", &sheet),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(
        worked_out("A1&\"x\"", &sheet),
        Value::Error(Error::NotAvailable)
    );
}

#[test]
fn an_error_written_into_a_formula_is_a_value() {
    assert_eq!(
        worked_out("#N/A", &Sheet::default()),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(
        worked_out("#N/A+1", &Sheet::default()),
        Value::Error(Error::NotAvailable)
    );
}

#[test]
fn an_unknown_name_is_the_error_that_says_so() {
    assert_eq!(
        worked_out("NOTAFUNCTION(1)", &Sheet::default()),
        Value::Error(Error::Name)
    );
    assert_eq!(
        worked_out("SomeName", &Sheet::default()),
        Value::Error(Error::Name)
    );
}

#[test]
fn an_array_literal_is_a_rectangle() {
    let Value::Array(array) = worked_out("{1,2;3,4}", &Sheet::default()) else {
        panic!("not an array")
    };

    assert_eq!((array.rows, array.columns), (2, 2));
    assert_eq!(array.at(0, 1), &Value::Number(2.0));
}

#[test]
fn the_subtraction_everybody_notices_comes_out_as_nothing() {
    // `=0.1+0.2-0.3` is 0 in every spreadsheet and 5.55e-17 in every other
    // calculator. Being the spreadsheet is the bar.
    assert_eq!(number("0.1+0.2-0.3"), 0.0);
    assert_eq!(number("1.1-1"), 0.1);
}

#[test]
fn a_whole_column_reaches_as_far_as_the_sheet_does() {
    let sheet = Sheet::with(&[("A1", Value::Number(1.0)), ("A2", Value::Number(2.0))]);

    let Value::Array(array) = worked_out("A:A", &sheet) else {
        panic!("not an array")
    };

    assert_eq!(array.columns, 1);
    assert_eq!(array.rows, 10);
    assert_eq!(array.at(1, 0), &Value::Number(2.0));
}
