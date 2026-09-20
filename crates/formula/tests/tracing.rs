//! Why a cell says what it says.
//!
//! The graph the engine keeps so that it knows what to work out again, asked
//! the other way round: what does this formula read, what reads it, and — when
//! it is an error — where did the error start. Excel draws the answers as
//! arrows; the engine's part is knowing them.

use formula::engine::Engine;
use formula::value::Value;

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

fn set(engine: &mut Engine, cell: &str, value: f64) {
    let (row, column) = address(cell);
    engine.set_value("Sheet1", row, column, Value::Number(value));
}

fn formula(engine: &mut Engine, cell: &str, text: &str) {
    let (row, column) = address(cell);
    engine
        .set_formula("Sheet1", row, column, text)
        .expect("the formula should parse");
}

fn trace(engine: &Engine, cell: &str) -> formula::engine::Trace {
    let (row, column) = address(cell);
    engine.trace("Sheet1", row, column)
}

/// A precedent said the way a person would say it: `Sheet1!B2:D4`.
fn shown(area: &formula::graph::Area) -> String {
    format!(
        "{}!r{}c{}:r{}c{}",
        area.sheet, area.top, area.left, area.bottom, area.right
    )
}

fn cells(cells: &[formula::graph::CellId]) -> Vec<String> {
    cells
        .iter()
        .map(|one| format!("{}!r{}c{}", one.0, one.1, one.2))
        .collect()
}

#[test]
fn a_formula_names_the_cells_it_reads() {
    let mut engine = Engine::new();
    set(&mut engine, "A1", 2.0);
    set(&mut engine, "A2", 3.0);
    formula(&mut engine, "B1", "A1+A2");

    let found = trace(&engine, "B1");
    let mut said: Vec<String> = found.precedents.iter().map(shown).collect();
    said.sort();

    assert_eq!(said, vec!["Sheet1!r0c0:r0c0", "Sheet1!r1c0:r1c0"]);
}

#[test]
fn a_range_comes_back_as_the_rectangle_it_is() {
    // One arrow to a box round the cells, which is how it is drawn and how a
    // person thinks about `SUM(A1:A9)`.
    let mut engine = Engine::new();
    formula(&mut engine, "B1", "SUM(A1:A9)");

    let found = trace(&engine, "B1");

    assert_eq!(found.precedents.len(), 1);
    assert_eq!(shown(&found.precedents[0]), "Sheet1!r0c0:r8c0");
}

#[test]
fn a_cell_that_is_not_a_formula_reads_nothing() {
    let mut engine = Engine::new();
    set(&mut engine, "A1", 2.0);

    assert!(trace(&engine, "A1").precedents.is_empty());
}

#[test]
fn the_formulas_that_name_a_cell_are_its_dependents() {
    let mut engine = Engine::new();
    set(&mut engine, "A1", 2.0);
    formula(&mut engine, "B1", "A1*3");
    formula(&mut engine, "C1", "A1+1");
    formula(&mut engine, "D1", "B1+1");

    assert_eq!(
        cells(&trace(&engine, "A1").dependents),
        vec!["Sheet1!r0c1", "Sheet1!r0c2"]
    );
}

#[test]
fn a_cell_inside_a_range_is_a_dependent_of_the_formula_over_it() {
    // The hard half: nothing wrote down an edge from A5 to B1, and the answer
    // still has to include it.
    let mut engine = Engine::new();
    formula(&mut engine, "B1", "SUM(A1:A9)");

    assert_eq!(cells(&trace(&engine, "A5").dependents), vec!["Sheet1!r0c1"]);
}

#[test]
fn a_volatile_formula_says_so() {
    // `OFFSET` is the case the graph cannot hold an edge for, and a trace that
    // showed nothing would look like a formula that reads nothing.
    let mut engine = Engine::new();
    formula(&mut engine, "B1", "OFFSET(A1,1,0)");

    assert!(trace(&engine, "B1").volatile);
}

#[test]
fn an_error_is_blamed_on_where_it_started() {
    let mut engine = Engine::new();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A2", 0.0);
    formula(&mut engine, "B1", "A1/A2");
    formula(&mut engine, "C1", "B1+1");
    formula(&mut engine, "D1", "C1*2");

    // D1 shows `#DIV/0!` and did not cause it; B1 did.
    assert_eq!(
        cells(&[trace(&engine, "D1").blame.unwrap()]),
        vec!["Sheet1!r0c1"]
    );
}

#[test]
fn a_cell_that_caused_its_own_error_is_blamed_on_nothing() {
    // Pointing at itself would be an arrow that says nothing.
    let mut engine = Engine::new();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A2", 0.0);
    formula(&mut engine, "B1", "A1/A2");

    assert!(trace(&engine, "B1").blame.is_none());
}

#[test]
fn a_cell_that_is_not_an_error_is_blamed_on_nothing() {
    let mut engine = Engine::new();
    set(&mut engine, "A1", 1.0);
    formula(&mut engine, "B1", "A1+1");

    assert!(trace(&engine, "B1").blame.is_none());
}

#[test]
fn an_error_inside_a_range_is_found() {
    // `SUM` over a column has the same error as the one cell in it that is
    // wrong, and that cell is what somebody is looking for.
    let mut engine = Engine::new();
    set(&mut engine, "A1", 1.0);
    set(&mut engine, "A3", 0.0);
    formula(&mut engine, "A5", "A1/A3");
    formula(&mut engine, "B1", "SUM(A1:A9)");

    assert_eq!(
        cells(&[trace(&engine, "B1").blame.unwrap()]),
        vec!["Sheet1!r4c0"]
    );
}

#[test]
fn a_cell_that_depends_on_itself_is_not_walked_for_ever() {
    let mut engine = Engine::new();
    formula(&mut engine, "A1", "A1+1");

    // The answer matters less than the fact that there is one.
    let _ = trace(&engine, "A1");
}
