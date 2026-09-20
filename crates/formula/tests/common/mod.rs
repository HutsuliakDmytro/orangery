//! The sheet the function tests are run against.
//!
//! One harness for every test binary in this crate: a map of cells, an A1
//! parser small enough to read, and the four ways a test asks what a formula
//! comes to. Each binary uses a different part of it, so nothing here is
//! expected to be called by all of them.

#![allow(dead_code)]

use std::collections::HashMap;

use formula::eval::{evaluate, Cells, Context};
use formula::parser::parse;
use formula::value::Value;

#[derive(Default)]
pub struct Sheet {
    cells: HashMap<(i64, i64), Value>,
}

impl Sheet {
    pub fn with(cells: &[(&str, Value)]) -> Self {
        let mut sheet = Sheet::default();
        for (at, value) in cells {
            sheet.cells.insert(address(at), value.clone());
        }
        sheet
    }
}

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
    fn value_at(&self, _sheet: Option<&str>, row: i64, column: i64) -> Value {
        self.cells
            .get(&(row, column))
            .cloned()
            .unwrap_or(Value::Blank)
    }

    fn extent(&self, _sheet: Option<&str>) -> (i64, i64) {
        (20, 20)
    }
}

pub fn on(sheet: &Sheet, formula: &str) -> Value {
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(
        &tree,
        &Context {
            cells: sheet,
            at: (0, 0),
        },
    )
}

pub fn value(formula: &str) -> Value {
    on(&Sheet::default(), formula)
}

pub fn number(formula: &str) -> f64 {
    match value(formula) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

pub fn text(formula: &str) -> String {
    match value(formula) {
        Value::Text(value) => value,
        other => panic!("{formula} is not text: {other:?}"),
    }
}

/// A column of numbers with a heading over it, which is what people pass.
pub fn column() -> Sheet {
    Sheet::with(&[
        ("A1", Value::Text("Amount".into())),
        ("A2", Value::Number(10.0)),
        ("A3", Value::Number(20.0)),
        ("A4", Value::Blank),
        ("A5", Value::Number(30.0)),
    ])
}

/// A formula worked out as though it were written in a particular cell, which
/// is the only way to ask what `ROW()` and `COLUMN()` answer.
pub fn on_cell(sheet: &Sheet, formula: &str, at: (i64, i64)) -> Value {
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(&tree, &Context { cells: sheet, at })
}
