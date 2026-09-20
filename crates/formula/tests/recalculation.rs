//! A sheet that keeps itself up to date.
//!
//! The question underneath every test here is the one a spreadsheet exists to
//! answer: somebody typed into a cell — what else on the sheet is now wrong,
//! and in what order does it have to be put right? A chain has to be walked
//! from the end that changed, and a cell that depends on itself has to be
//! reported rather than looped over for ever.

use formula::engine::Engine;
use formula::value::{Error, Value};

fn engine() -> Engine {
    Engine::new()
}

fn number(engine: &Engine, cell: &str) -> f64 {
    let (row, column) = address(cell);
    match engine.value("Sheet1", row, column) {
        Value::Number(value) => value,
        other => panic!("{cell} is not a number: {other:?}"),
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

/// A cell set to a number, said the way the tests read.
fn set(engine: &mut Engine, cell: &str, value: f64) {
    let (row, column) = address(cell);
    engine.set_value("Sheet1", row, column, Value::Number(value));
}

/// A cell set, with what the engine said changed because of it.
fn set_and_report(engine: &mut Engine, cell: &str, value: f64) -> formula::engine::Changed {
    let (row, column) = address(cell);
    engine.set_value("Sheet1", row, column, Value::Number(value))
}

fn formula(engine: &mut Engine, cell: &str, text: &str) {
    let (row, column) = address(cell);
    engine
        .set_formula("Sheet1", row, column, text)
        .expect("the formula should parse");
}

#[test]
fn a_formula_is_worked_out_when_it_is_written() {
    let mut engine = engine();
    set(&mut engine, "A1", 2.0);
    formula(&mut engine, "B1", "A1*3");

    assert_eq!(number(&engine, "B1"), 6.0);
}

#[test]
fn typing_into_a_cell_reaches_what_depends_on_it() {
    let mut engine = engine();
    set(&mut engine, "A1", 2.0);
    formula(&mut engine, "B1", "A1*3");

    set(&mut engine, "A1", 5.0);
    assert_eq!(number(&engine, "B1"), 15.0);
}

#[test]
fn it_reaches_the_whole_chain_and_in_the_right_order() {
    // C1 depends on B1 depends on A1: working C1 out first would use the old
    // B1 and be wrong by one step.
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    formula(&mut engine, "B1", "A1+1");
    formula(&mut engine, "C1", "B1*10");

    set(&mut engine, "A1", 4.0);

    assert_eq!(number(&engine, "B1"), 5.0);
    assert_eq!(number(&engine, "C1"), 50.0);
}

#[test]
fn a_cell_inside_a_range_reaches_the_formula_over_it() {
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A2", 2.0);
    formula(&mut engine, "B1", "SUM(A1:A3)");

    assert_eq!(number(&engine, "B1"), 3.0);

    set(&mut engine, "A3", 7.0);
    assert_eq!(number(&engine, "B1"), 10.0);
}

#[test]
fn a_cell_emptied_is_a_change_like_any_other() {
    let mut engine = engine();
    set(&mut engine, "A1", 5.0);
    formula(&mut engine, "B1", "A1+1");

    let (row, column) = address("A1");
    engine.clear("Sheet1", row, column);

    assert_eq!(number(&engine, "B1"), 1.0);
}

#[test]
fn only_what_changed_comes_back() {
    // A million formulas and one keystroke is the ordinary case; repainting
    // everything would be the slowest possible way to be right.
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    formula(&mut engine, "B1", "A1+1");
    formula(&mut engine, "C1", "100");

    let changed = engine.set_value("Sheet1", 0, 0, Value::Number(2.0));
    let touched: Vec<String> = changed
        .cells
        .iter()
        .map(|(cell, _)| format!("{}{}", cell.1, cell.2))
        .collect();

    assert_eq!(touched.len(), 2);
    assert!(!changed
        .cells
        .iter()
        .any(|(cell, _)| *cell == ("Sheet1".to_string(), 0, 2)));
}

#[test]
fn a_formula_that_changes_nothing_reports_nothing() {
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    formula(&mut engine, "B1", "IF(A1>100,1,0)");

    // A1 changes but B1's answer does not: the cell is not repainted.
    let changed = engine.set_value("Sheet1", 0, 0, Value::Number(2.0));
    assert_eq!(changed.cells.len(), 1);
}

#[test]
fn a_cell_that_depends_on_itself_is_reported_rather_than_looped_over() {
    let mut engine = engine();
    formula(&mut engine, "A1", "A1+1");

    let changed = engine.set_value("Sheet1", 5, 5, Value::Number(1.0));
    let _ = changed;

    let again = engine.recalculate();
    assert!(!again.circular.is_empty());
    assert_eq!(number(&engine, "A1"), 0.0);
}

#[test]
fn a_loop_round_three_cells_is_found_as_well() {
    let mut engine = engine();
    formula(&mut engine, "A1", "C1+1");
    formula(&mut engine, "B1", "A1+1");
    formula(&mut engine, "C1", "B1+1");

    let changed = engine.recalculate();
    assert_eq!(changed.circular.len(), 3);
}

#[test]
fn a_formula_replaced_by_a_value_stops_depending_on_anything() {
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    formula(&mut engine, "B1", "A1+1");

    set(&mut engine, "B1", 100.0);
    set(&mut engine, "A1", 50.0);

    assert_eq!(number(&engine, "B1"), 100.0);
}

#[test]
fn a_formula_can_be_asked_for_as_it_was_written() {
    let mut engine = engine();
    formula(&mut engine, "B1", "SUM(A1:A9)");

    assert_eq!(engine.formula("Sheet1", 0, 1), Some("SUM(A1:A9)"));
    assert_eq!(engine.formula("Sheet1", 0, 0), None);
}

#[test]
fn a_formula_reaches_another_sheet() {
    let mut engine = engine();
    engine.set_value("Notes", 0, 0, Value::Number(9.0));
    engine
        .set_formula("Sheet1", 0, 0, "Notes!A1*2")
        .expect("the formula should parse");

    assert_eq!(number(&engine, "A1"), 18.0);

    engine.set_value("Notes", 0, 0, Value::Number(10.0));
    assert_eq!(number(&engine, "A1"), 20.0);
}

#[test]
fn an_error_travels_the_chain_like_a_number() {
    let mut engine = engine();
    set(&mut engine, "A1", 0.0);
    formula(&mut engine, "B1", "1/A1");
    formula(&mut engine, "C1", "B1+1");

    assert_eq!(
        engine.value("Sheet1", 0, 2),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn a_formula_that_is_not_one_is_refused_rather_than_stored() {
    let mut engine = engine();
    assert!(engine.set_formula("Sheet1", 0, 0, "SUM(").is_err());
    assert_eq!(engine.value("Sheet1", 0, 0), Value::Blank);
}

#[test]
fn everything_can_be_worked_out_again_from_what_was_typed() {
    let mut engine = engine();
    set(&mut engine, "A1", 2.0);
    formula(&mut engine, "B1", "A1*2");
    formula(&mut engine, "C1", "B1*2");

    let changed = engine.recalculate();

    assert_eq!(number(&engine, "C1"), 8.0);
    assert!(changed.circular.is_empty());
}

#[test]
fn a_formula_that_works_out_where_to_look_is_worked_out_every_time() {
    // The graph has no edge from A3 to B1: `OFFSET(A1,C1,0)` names A1 and C1
    // and nothing else, and which cell it reads is a fact about a value. So
    // it is volatile, and volatile means worked out whatever changed.
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A2", 2.0);
    set(&mut engine, "A3", 3.0);
    set(&mut engine, "C1", 2.0);
    formula(&mut engine, "B1", "OFFSET(A1,C1,0)");
    assert_eq!(number(&engine, "B1"), 3.0);

    set(&mut engine, "A3", 99.0);
    assert_eq!(number(&engine, "B1"), 99.0);

    // And it still follows the value it was given for where to look.
    set(&mut engine, "C1", 1.0);
    assert_eq!(number(&engine, "B1"), 2.0);
}

#[test]
fn a_volatile_formula_that_came_out_the_same_is_not_a_cell_that_changed() {
    // Worked out again is not the same as changed: a repaint of every
    // volatile cell on every keystroke would be the slowest way to be right.
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A2", 2.0);
    formula(&mut engine, "B1", "OFFSET(A1,1,0)");

    let changed = set_and_report(&mut engine, "D9", 7.0);
    assert!(!changed
        .cells
        .iter()
        .any(|(cell, _)| cell == &("Sheet1".to_string(), 0, 1)));
}

#[test]
fn what_depends_on_a_volatile_formula_follows_it() {
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A2", 2.0);
    formula(&mut engine, "B1", "OFFSET(A1,1,0)");
    formula(&mut engine, "C1", "B1*10");
    assert_eq!(number(&engine, "C1"), 20.0);

    set(&mut engine, "A2", 5.0);
    assert_eq!(number(&engine, "C1"), 50.0);
}

#[test]
fn an_address_written_as_text_is_followed_when_the_text_changes() {
    let mut engine = engine();
    set(&mut engine, "A1", 10.0);
    set(&mut engine, "A2", 20.0);
    formula(&mut engine, "C1", "INDIRECT(\"A\"&D1)");
    set(&mut engine, "D1", 1.0);
    assert_eq!(number(&engine, "C1"), 10.0);

    set(&mut engine, "D1", 2.0);
    assert_eq!(number(&engine, "C1"), 20.0);

    // And the cell it landed on is followed too, though no edge says so.
    set(&mut engine, "A2", 30.0);
    assert_eq!(number(&engine, "C1"), 30.0);
}
