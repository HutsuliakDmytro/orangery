//! The sheet the function tests are run against.
//!
//! One harness for every test binary in this crate: a map of cells, an A1
//! parser small enough to read, and the four ways a test asks what a formula
//! comes to. Each binary uses a different part of it, so nothing here is
//! expected to be called by all of them.

#![allow(dead_code)]

use std::collections::HashMap;

use formula::ast::Structured;
use formula::date::DateSystem;
use formula::eval::{evaluate, Cells, Context, Rect};
use formula::parser::parse;
use formula::value::Value;

#[derive(Default)]
pub struct Sheet {
    cells: HashMap<(i64, i64), Value>,
    /// The tables on the sheet, for the references written in their words.
    tables: Vec<formula::table::Table>,
    /// What time the workbook is being worked out at; nought unless said.
    moment: f64,
    chance: f64,
    system: DateSystem,
}

impl Sheet {
    pub fn with(cells: &[(&str, Value)]) -> Self {
        let mut sheet = Sheet::default();
        for (at, value) in cells {
            sheet.cells.insert(address(at), value.clone());
        }
        sheet
    }

    /// A table over part of the sheet, with a header row at the top.
    ///
    /// The same answer the app has to give about its own tables, written
    /// small: where a table is is a fact about the workbook, and the engine
    /// is told rather than working it out.
    pub fn with_table(mut self, name: &str, at: &str, columns: &[&str]) -> Self {
        let (from, to) = at.split_once(':').unwrap_or((at, at));
        let (top, left) = address(from);
        let (bottom, right) = address(to);

        self.tables.push(formula::table::Table {
            name: name.to_string(),
            sheet: "Sheet1".to_string(),
            top,
            bottom,
            left,
            right,
            header_rows: 1,
            totals_rows: 0,
            columns: columns.iter().map(|name| (*name).to_string()).collect(),
        });
        self
    }

    /// A workbook being worked out at a particular moment, so that the two
    /// functions that ask what time it is can be tested at all.
    pub fn at_moment(mut self, serial: f64) -> Self {
        self.moment = serial;
        self
    }

    /// A workbook whose randomness is decided in advance, which is the only
    /// way to test a function whose whole purpose is to be unpredictable.
    pub fn with_random(mut self, value: f64) -> Self {
        self.chance = value;
        self
    }

    /// A workbook written by Excel for Mac before 2011.
    pub fn in_1904(mut self) -> Self {
        self.system = DateSystem::Excel1904;
        self
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

    fn area_of(&self, reference: &Structured, at: (i64, i64)) -> Option<Rect> {
        formula::table::area_of(&self.tables, reference, at)
    }

    fn now(&self) -> f64 {
        self.moment
    }

    fn random(&self) -> f64 {
        self.chance
    }

    fn date_system(&self) -> DateSystem {
        self.system
    }
}

pub fn on(sheet: &Sheet, formula: &str) -> Value {
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(
        &tree,
        &Context {
            cells: sheet,
            at: (0, 0),
            // Ranges whole, which is what these tests are about; the ones
            // about implicit intersection ask for it by name.
            intersect: false,
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
    evaluate(
        &tree,
        &Context {
            cells: sheet,
            at,
            intersect: false,
        },
    )
}

/// A formula worked out the way a file written before dynamic arrays meant it.
///
/// Implicit intersection on: a range used where a value is wanted gives the
/// cell of it that lines up with `at`.
pub fn intersecting(sheet: &Sheet, formula: &str, at: (i64, i64)) -> Value {
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(
        &tree,
        &Context {
            cells: sheet,
            at,
            intersect: true,
        },
    )
}
