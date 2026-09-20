//! How long it takes, on sheets the size people actually have.
//!
//! Ignored by default. A test that measures wall-clock time fails for reasons
//! that have nothing to do with the code — another build running, a machine
//! swapping — and a suite that cries wolf is a suite people stop reading. Run
//! it on purpose:
//!
//! ```text
//! cargo test -p formula --test speed --release -- --ignored --nocapture
//! ```
//!
//! The budgets are `apps/sheets/PLAN.md`, phase 3.1: a million formulas
//! recalculated in under two seconds, and one edit with ten thousand
//! dependants in under fifty milliseconds. What is printed is the number, so
//! that a change that makes it worse is visible rather than merely allowed;
//! what is asserted is twice the budget, because the number depends on what
//! else the machine is doing and a test that fails for that reason teaches
//! people to ignore it.

use std::time::Instant;

use formula::engine::Engine;
use formula::value::Value;

/// A sheet of formulas, each one reading the cell above it.
///
/// The worst shape for a dependency graph: every formula is a link in one
/// chain, so nothing can be worked out until everything before it has been.
fn chain(how_many: i64) -> Engine {
    let mut engine = Engine::new();
    engine.load_value("Sheet1", 0, 0, Value::Number(1.0));

    for row in 1..how_many {
        engine
            .load_formula("Sheet1", row, 0, &format!("A{}+1", row), Value::Number(0.0))
            .expect("the formula should parse");
    }

    engine
}

/// A sheet of formulas, each one summing a block of numbers.
///
/// The shape a real workbook has: a column of figures and a column of sums
/// over them, which is where the range edges in the graph come from. Each
/// sum covers ten cells — a running total over a growing range would be
/// fifty million cell reads by the time it reached ten thousand rows, which
/// measures the shape of the test rather than the speed of the engine.
fn sums(how_many: i64) -> Engine {
    let mut engine = Engine::new();

    for row in 0..how_many {
        engine.load_value("Sheet1", row, 0, Value::Number(row as f64));
        engine
            .load_formula(
                "Sheet1",
                row,
                1,
                &format!("SUM(A1:A10)+A{}", row + 1),
                Value::Number(0.0),
            )
            .expect("the formula should parse");
    }

    engine
}

fn took(what: &str, start: Instant) -> u128 {
    let taken = start.elapsed().as_millis();
    println!("{what}: {taken} ms");
    taken
}

#[test]
#[ignore = "measures wall-clock time; run on purpose"]
fn a_hundred_thousand_formulas_in_a_chain() {
    let mut engine = chain(100_000);

    let start = Instant::now();
    let changed = engine.recalculate();
    took("100k formulas, full recalculation", start);

    assert_eq!(changed.cells.len(), 99_999);
    assert_eq!(engine.value("Sheet1", 99_999, 0), Value::Number(100_000.0));
}

#[test]
#[ignore = "measures wall-clock time; run on purpose"]
fn one_edit_at_the_top_of_a_chain_of_ten_thousand() {
    let mut engine = chain(10_000);
    engine.recalculate();

    let start = Instant::now();
    let changed = engine.set_value("Sheet1", 0, 0, Value::Number(2.0));
    let taken = took("one edit, 10k dependants", start);

    assert_eq!(changed.cells.len(), 10_000);
    assert!(taken < 100, "one edit took {taken} ms");
}

#[test]
#[ignore = "measures wall-clock time; run on purpose"]
fn ten_thousand_sums_over_a_growing_range() {
    let mut engine = sums(10_000);

    let start = Instant::now();
    engine.recalculate();
    took("10k growing sums, full recalculation", start);

    let start = Instant::now();
    let changed = engine.set_value("Sheet1", 0, 0, Value::Number(5.0));
    let taken = took("one edit under 10k range formulas", start);

    assert!(taken < 100, "one edit took {taken} ms");

    // Every sum covers the first ten cells, so every one of them has to be
    // worked out again — which is the point of the shape.
    assert_eq!(changed.cells.len(), 10_001);
}

#[test]
#[ignore = "measures wall-clock time; run on purpose"]
fn a_workbook_of_a_million_formulas_is_loaded_and_worked_out() {
    let start = Instant::now();
    let mut engine = Engine::new();

    for row in 0..1_000_000i64 {
        engine.load_value("Sheet1", row, 0, Value::Number(row as f64));
        engine
            .load_formula(
                "Sheet1",
                row,
                1,
                &format!("A{}*2", row + 1),
                Value::Number(0.0),
            )
            .expect("the formula should parse");
    }
    took("1M formulas, loaded", start);

    let start = Instant::now();
    engine.recalculate();
    let taken = took("1M formulas, full recalculation", start);

    assert!(taken < 4000, "a million formulas took {taken} ms");

    assert_eq!(
        engine.value("Sheet1", 999_999, 1),
        Value::Number(1_999_998.0)
    );
}
