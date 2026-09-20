//! A sheet that keeps itself up to date.
//!
//! The question underneath every test here is the one a spreadsheet exists to
//! answer: somebody typed into a cell — what else on the sheet is now wrong,
//! and in what order does it have to be put right? A chain has to be walked
//! from the end that changed, and a cell that depends on itself has to be
//! reported rather than looped over for ever.

use formula::engine::{self, Engine};
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

#[test]
fn a_workbook_loaded_keeps_the_values_the_file_came_with() {
    // A file's numbers were worked out by whatever wrote it, and they are
    // trusted until somebody types. Loading must not recalculate: a hundred
    // thousand formulas arriving one at a time would be a hundred thousand
    // recalculations over cells that have not arrived yet.
    let mut engine = engine();
    engine.load_value("Sheet1", 0, 0, Value::Number(2.0));
    engine
        .load_formula("Sheet1", 0, 1, "A1*3", Value::Number(99.0))
        .expect("the formula should parse");

    assert_eq!(number(&engine, "B1"), 99.0);

    // And when it is asked, everything is worked out in order.
    let changed = engine.recalculate();
    assert_eq!(number(&engine, "B1"), 6.0);
    assert!(
        changed
            .cells
            .iter()
            .any(|(cell, value)| cell == &("Sheet1".to_string(), 0, 1)
                && *value == Value::Number(6.0))
    );
}

#[test]
fn a_loaded_workbook_reaches_the_whole_chain_from_one_edit() {
    let mut engine = engine();
    engine.load_value("Sheet1", 0, 0, Value::Number(2.0));
    engine
        .load_formula("Sheet1", 0, 1, "A1*3", Value::Number(6.0))
        .expect("the formula should parse");
    engine
        .load_formula("Sheet1", 0, 2, "B1+1", Value::Number(7.0))
        .expect("the formula should parse");

    set(&mut engine, "A1", 5.0);
    assert_eq!(number(&engine, "B1"), 15.0);
    assert_eq!(number(&engine, "C1"), 16.0);
}

#[test]
fn the_same_seed_gives_the_same_column_of_random_numbers() {
    // Which is what makes a workbook recalculated on two machines agree, and
    // what makes this testable at all.
    let mut first = engine();
    first.seed_random(7);
    formula(&mut first, "A1", "RAND()");
    formula(&mut first, "A2", "RANDBETWEEN(1,6)");

    let mut second = engine();
    second.seed_random(7);
    formula(&mut second, "A1", "RAND()");
    formula(&mut second, "A2", "RANDBETWEEN(1,6)");

    assert_eq!(number(&first, "A1"), number(&second, "A1"));
    assert_eq!(number(&first, "A2"), number(&second, "A2"));
    assert!((0.0..1.0).contains(&number(&first, "A1")));
    assert!((1.0..=6.0).contains(&number(&first, "A2")));
}

#[test]
fn the_time_and_the_date_system_are_the_workbooks_own() {
    let mut engine = engine();
    engine.set_moment(45292.75);
    formula(&mut engine, "A1", "TODAY()");
    formula(&mut engine, "A2", "YEAR(NOW())");
    assert_eq!(number(&engine, "A1"), 45292.0);
    assert_eq!(number(&engine, "A2"), 2024.0);

    let mut mac = engine::Engine::new();
    mac.set_date_system(formula::date::DateSystem::Excel1904);
    mac.set_formula("Sheet1", 0, 0, "DATE(2024,1,1)")
        .expect("the formula should parse");
    assert_eq!(mac.value("Sheet1", 0, 0), Value::Number(43830.0));
}

#[test]
fn a_subtotal_leaves_out_the_rows_a_filter_hid() {
    // The classic wrong answer in a spreadsheet is `SUM` over a filtered
    // table: it adds the rows nobody can see, and the figure at the bottom
    // disagrees with the figures above it.
    let mut engine = engine();
    set(&mut engine, "A1", 10.0);
    set(&mut engine, "A2", 20.0);
    set(&mut engine, "A3", 30.0);
    formula(&mut engine, "B1", "SUBTOTAL(9,A1:A3)");
    formula(&mut engine, "B2", "SUM(A1:A3)");
    assert_eq!(number(&engine, "B1"), 60.0);

    engine.set_out_of_sight("Sheet1", vec![1], vec![]);
    engine.recalculate();

    assert_eq!(number(&engine, "B1"), 40.0);
    // And `SUM` still adds what it was given, which is the whole difference
    // between the two.
    assert_eq!(number(&engine, "B2"), 60.0);
}

#[test]
fn only_the_hundreds_leave_out_a_row_somebody_hid_by_hand() {
    // Hiding a row and filtering a table are different acts, and this is
    // where a formula can tell them apart.
    let mut engine = engine();
    set(&mut engine, "A1", 10.0);
    set(&mut engine, "A2", 20.0);
    formula(&mut engine, "B1", "SUBTOTAL(9,A1:A2)");
    formula(&mut engine, "B2", "SUBTOTAL(109,A1:A2)");

    engine.set_out_of_sight("Sheet1", vec![], vec![0]);
    engine.recalculate();

    assert_eq!(number(&engine, "B1"), 30.0);
    assert_eq!(number(&engine, "B2"), 20.0);
}

#[test]
fn a_grand_total_does_not_count_the_subtotals_under_it() {
    // A column with subtotals down it and a grand total at the bottom is the
    // ordinary shape of a report, and a grand total that counted them would
    // count every figure twice.
    let mut engine = engine();
    set(&mut engine, "A1", 10.0);
    set(&mut engine, "A2", 20.0);
    formula(&mut engine, "A3", "SUBTOTAL(9,A1:A2)");
    set(&mut engine, "A4", 5.0);
    formula(&mut engine, "A5", "SUBTOTAL(9,A4:A4)");
    formula(&mut engine, "A6", "SUBTOTAL(9,A1:A5)");

    assert_eq!(number(&engine, "A3"), 30.0);
    assert_eq!(number(&engine, "A6"), 35.0);
}

#[test]
fn aggregate_can_be_told_to_step_over_the_broken_cells() {
    // Which is what somebody wants when one cell in a thousand is stopping
    // the total.
    let mut engine = engine();
    set(&mut engine, "A1", 10.0);
    engine.set_value("Sheet1", 1, 0, Value::Error(Error::DivideByZero));
    set(&mut engine, "A3", 30.0);

    formula(&mut engine, "B1", "AGGREGATE(9,6,A1:A3)");
    formula(&mut engine, "B2", "SUM(A1:A3)");
    formula(&mut engine, "B3", "AGGREGATE(14,6,A1:A3,1)");

    assert_eq!(number(&engine, "B1"), 40.0);
    assert_eq!(number(&engine, "B3"), 30.0);
    // And a plain sum still says what is wrong, because that is what an
    // error is for.
    assert_eq!(
        engine.value("Sheet1", 1, 1),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn an_answer_too_big_for_a_cell_fills_the_cells_beside_it() {
    // Which is the whole of what a dynamic array is, and the reason a
    // formula can now change cells nobody typed in.
    let mut engine = engine();
    set(&mut engine, "A1", 3.0);
    set(&mut engine, "A2", 1.0);
    set(&mut engine, "A3", 2.0);
    formula(&mut engine, "C1", "SORT(A1:A3)");

    assert_eq!(number(&engine, "C1"), 1.0);
    assert_eq!(number(&engine, "C2"), 2.0);
    assert_eq!(number(&engine, "C3"), 3.0);
}

#[test]
fn a_spill_that_shrinks_gives_back_what_it_no_longer_covers() {
    // Or the sheet keeps showing numbers from an answer that is no longer
    // true, which is worse than showing none.
    let mut engine = engine();
    formula(&mut engine, "A1", "SEQUENCE(3)");
    assert_eq!(number(&engine, "A3"), 3.0);

    formula(&mut engine, "A1", "SEQUENCE(2)");
    assert_eq!(engine.value("Sheet1", 2, 0), Value::Blank);
    assert_eq!(number(&engine, "A2"), 2.0);
}

#[test]
fn a_formula_taken_away_takes_its_spill_with_it() {
    let mut engine = engine();
    formula(&mut engine, "A1", "SEQUENCE(3)");
    assert_eq!(number(&engine, "A3"), 3.0);

    engine.clear("Sheet1", 0, 0);
    assert_eq!(engine.value("Sheet1", 1, 0), Value::Blank);
    assert_eq!(engine.value("Sheet1", 2, 0), Value::Blank);
}

#[test]
fn something_in_the_way_stops_a_spill_rather_than_being_written_over() {
    // A formula that quietly replaced a column of typed figures would be the
    // worst thing a spreadsheet could do.
    let mut engine = engine();
    set(&mut engine, "A3", 99.0);
    formula(&mut engine, "A1", "SEQUENCE(3)");

    assert_eq!(engine.value("Sheet1", 0, 0), Value::Error(Error::Spill));
    assert_eq!(number(&engine, "A3"), 99.0);
    // And the cell in between is not half a spill.
    assert_eq!(engine.value("Sheet1", 1, 0), Value::Blank);
}

#[test]
fn typing_into_a_spill_breaks_it_and_says_so() {
    let mut engine = engine();
    formula(&mut engine, "A1", "SEQUENCE(3)");
    assert_eq!(number(&engine, "A3"), 3.0);

    set(&mut engine, "A2", 5.0);

    assert_eq!(engine.value("Sheet1", 0, 0), Value::Error(Error::Spill));
    assert_eq!(number(&engine, "A2"), 5.0);
    assert_eq!(engine.value("Sheet1", 2, 0), Value::Blank);
}

#[test]
fn what_depends_on_a_spilled_cell_follows_it() {
    // The graph has no edge to the third cell of a spill: nobody wrote a
    // formula there. It is reached by walking again from what the spill
    // moved, which is the second pass Excel does too.
    let mut engine = engine();
    formula(&mut engine, "A1", "SEQUENCE(3)");
    formula(&mut engine, "C1", "A3*10");
    assert_eq!(number(&engine, "C1"), 30.0);

    formula(&mut engine, "A1", "SEQUENCE(3,1,10)");
    assert_eq!(number(&engine, "A3"), 12.0);
    assert_eq!(number(&engine, "C1"), 120.0);
}

#[test]
fn a_formula_naming_another_workbook_keeps_the_number_it_came_with() {
    // Nothing here can open that file. Working the formula out would mean
    // answering `#REF!` about a figure that is probably still true, which
    // loses the figure and tells the reader nothing they can act on — so the
    // cell keeps what its file was saved with, as Excel does until somebody
    // updates the link.
    let mut engine = engine();
    engine
        .load_formula(
            "Sheet1",
            0,
            0,
            "[Budget.xlsx]Sheet1!A1*2",
            Value::Number(500.0),
        )
        .expect("the formula should parse");

    engine.recalculate();
    assert_eq!(number(&engine, "A1"), 500.0);

    set(&mut engine, "B1", 1.0);
    assert_eq!(number(&engine, "A1"), 500.0);
}

#[test]
fn a_name_is_a_formula_somebody_has_named() {
    // Which is what makes `=Tax_Rate` readable where `=Sheet2!$B$1` is not.
    let mut engine = engine();
    engine.set_name("Tax_Rate", "0.2");
    engine.set_name("Sales", "A1:A3");

    set(&mut engine, "A1", 10.0);
    set(&mut engine, "A2", 20.0);
    set(&mut engine, "A3", 30.0);
    formula(&mut engine, "B1", "SUM(Sales)*Tax_Rate");

    assert_eq!(number(&engine, "B1"), 12.0);

    // A name standing for a range is a range: what it reaches has to follow
    // the cells rather than a copy of their values.
    set(&mut engine, "A2", 50.0);
    assert_eq!(number(&engine, "B1"), 18.0);
}

#[test]
fn a_name_nobody_has_defined_still_says_so() {
    // The formula keeps its text and the cell says plainly that this program
    // did not know the word.
    let mut engine = engine();
    formula(&mut engine, "A1", "Nowhere+1");

    assert_eq!(engine.value("Sheet1", 0, 0), Value::Error(Error::Name));
}

#[test]
fn a_name_is_matched_whatever_case_it_was_written_in() {
    let mut engine = engine();
    engine.set_name("Tax_Rate", "0.2");
    formula(&mut engine, "A1", "tax_rate*100");

    assert_eq!(number(&engine, "A1"), 20.0);
}

#[test]
fn goal_seek_finds_the_number_that_makes_a_formula_come_out() {
    // There is no way to run a spreadsheet backwards, so it is done by
    // trying: set the cell, recalculate, and use the distance to guess again.
    let mut engine = engine();
    set(&mut engine, "A1", 1.0);
    formula(&mut engine, "B1", "A1*3+2");

    let found = engine.goal_seek(("Sheet1", 0, 1), 20.0, ("Sheet1", 0, 0));

    assert!(found.is_some());
    assert!((number(&engine, "A1") - 6.0).abs() < 1e-6);
    assert!((number(&engine, "B1") - 20.0).abs() < 1e-6);
}

#[test]
fn goal_seek_works_where_the_arithmetic_is_not_a_straight_line() {
    let mut engine = engine();
    set(&mut engine, "A1", 2.0);
    formula(&mut engine, "B1", "A1^2");

    let found = engine.goal_seek(("Sheet1", 0, 1), 9.0, ("Sheet1", 0, 0));

    assert!(found.is_some());
    assert!((number(&engine, "A1") - 3.0).abs() < 1e-4);
}

#[test]
fn a_search_that_found_nothing_puts_the_cell_back() {
    // A sheet left holding the last guess of a failed search would be a
    // sheet somebody had to notice and undo.
    let mut engine = engine();
    set(&mut engine, "A1", 5.0);
    formula(&mut engine, "B1", "7");

    assert_eq!(
        engine.goal_seek(("Sheet1", 0, 1), 20.0, ("Sheet1", 0, 0)),
        None
    );
    assert_eq!(number(&engine, "A1"), 5.0);
}
