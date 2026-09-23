//! The functions whose answer does not fit in a cell.
//!
//! What is tested here is the rectangle each one hands back. Where that
//! rectangle ends up — the cells below and to the right of the formula — is
//! the engine's business and is tested with the rest of recalculation.

mod common;

use common::{on, Sheet};
use formula::value::{Error, Value};

fn answer(formula: &str) -> Value {
    on(&Sheet::default(), formula)
}

/// The rectangle a formula came to, written out row by row.
///
/// As text, because a table of answers reads better than a list of `Value`s
/// and because what is being checked is the shape and the order rather than
/// the kind of each one.
fn grid(formula: &str) -> Vec<Vec<String>> {
    match answer(formula) {
        Value::Array(array) => (0..array.rows)
            .map(|row| {
                (0..array.columns)
                    .map(|column| match array.at(row, column) {
                        Value::Error(error) => error.text().to_string(),
                        other => other.to_text().unwrap_or_default(),
                    })
                    .collect()
            })
            .collect(),
        other => panic!("{formula} is not a rectangle: {other:?}"),
    }
}

/// One column of answers, which is the shape most of these make.
fn column(formula: &str) -> Vec<String> {
    grid(formula).into_iter().flatten().collect()
}

#[test]
fn sequence_counts_in_whatever_steps_it_is_given() {
    assert_eq!(column("SEQUENCE(3)"), ["1", "2", "3"]);
    assert_eq!(column("SEQUENCE(2,3)"), ["1", "2", "3", "4", "5", "6"]);
    assert_eq!(column("SEQUENCE(3,1,10,5)"), ["10", "15", "20"]);
    assert_eq!(column("SEQUENCE(3,1,0,-1)"), ["0", "-1", "-2"]);
    assert_eq!(grid("SEQUENCE(2,3)").len(), 2);
    assert_eq!(answer("SEQUENCE(0)"), Value::Error(Error::Value));
}

#[test]
fn transpose_turns_the_rectangle_on_its_side() {
    assert_eq!(grid("TRANSPOSE({1,2;3,4})"), [["1", "3"], ["2", "4"]]);
    assert_eq!(grid("TRANSPOSE({1,2,3})").len(), 3);
    assert_eq!(grid("TRANSPOSE({1;2;3})").len(), 1);
    assert_eq!(column("TRANSPOSE({1;2;3})"), ["1", "2", "3"]);
    assert_eq!(
        grid("TRANSPOSE(TRANSPOSE({1,2;3,4}))"),
        [["1", "2"], ["3", "4"]]
    );
}

#[test]
fn sort_moves_whole_rows() {
    // A table sorted a column at a time is a table whose rows have stopped
    // meaning anything, which is the one mistake a sort must never make on
    // somebody's behalf.
    assert_eq!(column("SORT({3;1;2})"), ["1", "2", "3"]);
    assert_eq!(column("SORT({3;1;2},1,-1)"), ["3", "2", "1"]);
    assert_eq!(grid("SORT({\"b\",2;\"a\",1})"), [["a", "1"], ["b", "2"]]);
    // Sorted by the second column instead.
    assert_eq!(grid("SORT({\"b\",1;\"a\",2},2)"), [["b", "1"], ["a", "2"]]);
    assert_eq!(answer("SORT({1;2},3)"), Value::Error(Error::Value));
}

#[test]
fn sort_can_be_asked_to_work_along_the_rows_instead() {
    assert_eq!(grid("SORT({3,1,2},1,1,TRUE)"), [["1", "2", "3"]]);
    assert_eq!(
        grid("SORT({3,1,2;30,10,20},1,1,TRUE)"),
        [["1", "2", "3"], ["10", "20", "30"]]
    );
}

#[test]
fn sortby_sorts_one_thing_by_another() {
    // And the thing sorted by need not be in the table at all, which is the
    // difference from `SORT` and the reason this one exists.
    assert_eq!(
        column("SORTBY({\"a\";\"b\";\"c\"},{3;1;2})"),
        ["b", "c", "a"]
    );
    assert_eq!(
        column("SORTBY({\"a\";\"b\";\"c\"},{3;1;2},-1)"),
        ["a", "c", "b"]
    );
    // Two keys, applied in the order they were given.
    assert_eq!(
        column("SORTBY({\"a\";\"b\";\"c\"},{1;1;2},1,{2;1;1},1)"),
        ["b", "a", "c"]
    );
    assert_eq!(
        answer("SORTBY({\"a\";\"b\"},{1;2;3})"),
        Value::Error(Error::Value)
    );
}

#[test]
fn filter_keeps_the_rows_that_answered_yes() {
    assert_eq!(column("FILTER({1;2;3},{TRUE;FALSE;TRUE})"), ["1", "3"]);
    assert_eq!(column("FILTER({1;2;3},{1;0;1})"), ["1", "3"]);
    assert_eq!(grid("FILTER({\"a\",1;\"b\",2},{TRUE;FALSE})"), [["a", "1"]]);
    // Nothing matching is not nothing: a formula has to show something, and
    // Excel lets the caller say what.
    assert_eq!(
        answer("FILTER({1;2},{FALSE;FALSE})"),
        Value::Error(Error::Calc)
    );
    assert_eq!(
        answer("FILTER({1;2},{FALSE;FALSE},\"none\")"),
        Value::Text("none".into())
    );
    // A test of a different size is a question about a different table.
    assert_eq!(
        answer("FILTER({1;2;3},{TRUE;FALSE})"),
        Value::Error(Error::Value)
    );
}

#[test]
fn unique_keeps_the_first_of_each() {
    assert_eq!(column("UNIQUE({1;2;2;3})"), ["1", "2", "3"]);
    assert_eq!(column("UNIQUE({\"a\";\"A\";\"b\"})"), ["a", "b"]);
    // Whole rows, so two rows are the same only when all of them match.
    assert_eq!(
        grid("UNIQUE({\"a\",1;\"a\",2;\"a\",1})"),
        [["a", "1"], ["a", "2"]]
    );
    // "Exactly once" is a different question from "which ones are there":
    // it leaves out the thing that happened twice altogether.
    assert_eq!(column("UNIQUE({1;2;2;3},FALSE,TRUE)"), ["1", "3"]);
    assert_eq!(
        answer("UNIQUE({1;1},FALSE,TRUE)"),
        Value::Error(Error::Calc)
    );
}

#[test]
fn textsplit_makes_a_table_out_of_a_line_of_text() {
    assert_eq!(grid("TEXTSPLIT(\"a,b\",\",\")"), [["a", "b"]]);
    assert_eq!(
        grid("TEXTSPLIT(\"a,b;c,d\",\",\",\";\")"),
        [["a", "b"], ["c", "d"]]
    );
    assert_eq!(grid("TEXTSPLIT(\"a;b\",\"\",\";\")"), [["a"], ["b"]]);
    // A short line leaves `#N/A` in the cells it does not reach, as a ragged
    // array literal does: the cells are there and there is nothing for them.
    assert_eq!(
        grid("TEXTSPLIT(\"a,b;c\",\",\",\";\")"),
        [["a", "b"], ["c", "#N/A"]]
    );
    assert_eq!(
        answer("TEXTSPLIT(\"a,b\",\"\",\"\")"),
        Value::Error(Error::Value)
    );
}

#[test]
fn randarray_is_a_rectangle_of_the_same_unpredictability() {
    let sheet = Sheet::default().with_random(0.25);

    match on(&sheet, "RANDARRAY(2,3)") {
        Value::Array(array) => {
            assert_eq!((array.rows, array.columns), (2, 3));
            assert!(array.values.iter().all(
                |value| matches!(value, Value::Number(number) if (0.0..1.0).contains(number))
            ));
        }
        other => panic!("not a rectangle: {other:?}"),
    }

    // Whole numbers between two bounds, both ends included as
    // `RANDBETWEEN` has them.
    assert_eq!(column("RANDARRAY(1,1,5,5,TRUE)"), ["5"]);
    assert_eq!(on(&sheet, "RANDARRAY(0)"), Value::Error(Error::Value));
}

/// Implicit intersection: what a range means in a formula written before
/// dynamic arrays, which is every formula in every file that does not say
/// `cm="1"` or `t="array"`.
///
/// Every expectation here is a cell out of the corpus, checked against the
/// value the workbook's own writer cached beside the formula.
mod implicit_intersection {
    use super::*;
    use common::intersecting;

    /// `Spill.xlsx`, column A: 10, 20, 30, 40 in rows 2 to 5.
    fn column() -> Sheet {
        Sheet::with(&[
            ("A2", Value::Number(10.0)),
            ("A3", Value::Number(20.0)),
            ("A4", Value::Number(30.0)),
            ("A5", Value::Number(40.0)),
        ])
    }

    #[test]
    fn a_range_gives_the_cell_in_the_formulas_own_row() {
        // `=$A$2:$A$5` in F3 is `=A3`, which is 20.
        assert_eq!(
            intersecting(&column(), "$A$2:$A$5", (2, 5)),
            Value::Number(20.0)
        );
        assert_eq!(
            intersecting(&column(), "$A$2:$A$5", (4, 5)),
            Value::Number(40.0)
        );
    }

    #[test]
    fn a_row_of_cells_gives_the_one_in_the_formulas_own_column() {
        let sheet = Sheet::with(&[
            ("A1", Value::Number(1.0)),
            ("B1", Value::Number(2.0)),
            ("C1", Value::Number(3.0)),
        ]);

        assert_eq!(intersecting(&sheet, "A1:C1", (5, 1)), Value::Number(2.0));
    }

    #[test]
    fn a_range_the_formula_does_not_line_up_with_is_a_value_error() {
        // Excel's answer for `=$A$2:$A$5` written in a row the range does not
        // reach: the formula is pointing at cells it has no line to.
        assert_eq!(
            intersecting(&column(), "$A$2:$A$5", (9, 5)),
            Value::Error(Error::Value)
        );
    }

    #[test]
    fn a_rectangle_takes_the_row_and_the_column() {
        let sheet = Sheet::with(&[
            ("B1", Value::Number(1.0)),
            ("C1", Value::Number(2.0)),
            ("B2", Value::Number(11.0)),
            ("C2", Value::Number(12.0)),
            ("B3", Value::Number(21.0)),
            ("C3", Value::Number(22.0)),
        ]);

        // The cell of B1:C3 that shares both the formula's row and its column.
        assert_eq!(intersecting(&sheet, "B1:C3", (1, 1)), Value::Number(11.0));
        assert_eq!(
            intersecting(&sheet, "B1:C3", (1, 9)),
            Value::Error(Error::Value)
        );
    }

    #[test]
    fn one_cell_is_itself_wherever_the_formula_is() {
        assert_eq!(intersecting(&column(), "A2", (9, 9)), Value::Number(10.0));
    }

    /// `tdf138744.xlsx`, sheet `sqrt`: `SQRT(B2:F2)` in B6 is Excel's 1.
    #[test]
    fn a_function_that_takes_a_value_gets_the_intersection() {
        let sheet = Sheet::with(&[
            ("B2", Value::Number(1.0)),
            ("C2", Value::Number(4.0)),
            ("D2", Value::Number(9.0)),
            ("E2", Value::Number(16.0)),
            ("F2", Value::Number(25.0)),
        ]);

        // Written in column B, so the range gives B2, and the root of 1 is 1.
        assert_eq!(
            intersecting(&sheet, "SQRT(B2:F2)", (5, 1)),
            Value::Number(1.0)
        );
        assert_eq!(
            intersecting(&sheet, "SQRT(B2:F2)", (5, 3)),
            Value::Number(3.0)
        );
    }

    #[test]
    fn a_function_that_takes_a_range_still_gets_the_range() {
        // The rule is about where a value is wanted. `SUM` wants the five.
        assert_eq!(
            intersecting(&column(), "SUM($A$2:$A$5)", (2, 5)),
            Value::Number(100.0)
        );
        assert_eq!(
            intersecting(&column(), "COUNT($A$2:$A$5)", (9, 9)),
            Value::Number(4.0)
        );
    }

    #[test]
    fn arithmetic_on_two_ranges_intersects_both() {
        let sheet = Sheet::with(&[
            ("A1", Value::Number(1.0)),
            ("A2", Value::Number(2.0)),
            ("A3", Value::Number(3.0)),
            ("B1", Value::Number(10.0)),
            ("B2", Value::Number(20.0)),
            ("B3", Value::Number(30.0)),
        ]);

        assert_eq!(
            intersecting(&sheet, "A1:A3+B1:B3", (1, 5)),
            Value::Number(22.0)
        );
    }

    #[test]
    fn a_comparison_of_two_ranges_intersects_both() {
        let sheet = Sheet::with(&[
            ("A2", Value::Text("aaa".into())),
            ("F2", Value::Text("aaa".into())),
        ]);

        assert_eq!(
            intersecting(&sheet, "IF($A$2:$A$9 = $F$2:$F$9, TRUE, FALSE)", (1, 6)),
            Value::Bool(true)
        );
    }

    #[test]
    fn a_whole_column_intersects_with_the_formulas_row() {
        let sheet = Sheet::with(&[
            ("B1", Value::Number(5.0)),
            ("B2", Value::Number(6.0)),
            ("B3", Value::Number(7.0)),
        ]);

        assert_eq!(intersecting(&sheet, "B:B", (1, 4)), Value::Number(6.0));
    }
}
