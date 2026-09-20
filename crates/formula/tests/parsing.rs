//! Reading a formula.
//!
//! What is asserted here is what a person would notice: that `A1` is a
//! reference and `Sheet1` is not, that `2*3+4` is ten rather than fourteen,
//! and that a formula out of somebody else's file — with a sheet name full of
//! spaces, an error value written into it, a function nobody here has heard
//! of — is read rather than refused.

use formula::ast::{Expr, Operator};
use formula::parser::parse;
use formula::reference::{Reference, ReferenceKind};

fn parsed(text: &str) -> Expr {
    parse(text).unwrap_or_else(|error| panic!("{text} did not parse: {error}"))
}

fn binary(expression: &Expr) -> (Operator, &Expr, &Expr) {
    match expression {
        Expr::Binary {
            operator,
            left,
            right,
        } => (*operator, left.as_ref(), right.as_ref()),
        other => panic!("not an operator: {other:?}"),
    }
}

#[test]
fn a_number_is_a_number() {
    assert_eq!(parsed("42"), Expr::Number(42.0));
    assert_eq!(parsed("=42"), Expr::Number(42.0));
    assert_eq!(parsed("1.5e3"), Expr::Number(1500.0));
    assert_eq!(parsed(".5"), Expr::Number(0.5));
}

#[test]
fn a_string_holds_the_quotes_it_doubled() {
    assert_eq!(
        parsed("\"she said \"\"yes\"\"\""),
        Expr::Text("she said \"yes\"".to_string())
    );
}

#[test]
fn the_two_words_are_values_rather_than_names() {
    assert_eq!(parsed("TRUE"), Expr::Bool(true));
    assert_eq!(parsed("false"), Expr::Bool(false));
}

#[test]
fn an_error_is_a_value_written_into_the_formula() {
    assert_eq!(parsed("#N/A"), Expr::Error("#N/A".to_string()));
    assert_eq!(parsed("#DIV/0!"), Expr::Error("#DIV/0!".to_string()));
}

#[test]
fn a_cell_is_a_reference_and_a_word_is_not() {
    assert_eq!(parsed("A1"), Expr::Reference(Reference::cell(0, 0)));
    assert_eq!(parsed("Sheet1"), Expr::Name("Sheet1".to_string()));
    assert_eq!(parsed("A1B"), Expr::Name("A1B".to_string()));
}

#[test]
fn the_dollars_are_kept_because_a_copy_depends_on_them() {
    let Expr::Reference(reference) = parsed("$B$2") else {
        panic!("not a reference")
    };

    match reference.kind {
        ReferenceKind::Cell { row, column } => {
            assert_eq!((row.index, row.absolute), (1, true));
            assert_eq!((column.index, column.absolute), (1, true));
        }
        other => panic!("not a cell: {other:?}"),
    }
}

#[test]
fn half_pinned_references_keep_which_half() {
    let Expr::Reference(reference) = parsed("$B2") else {
        panic!("not a reference")
    };

    match reference.kind {
        ReferenceKind::Cell { row, column } => {
            assert!(!row.absolute);
            assert!(column.absolute);
        }
        other => panic!("not a cell: {other:?}"),
    }
}

#[test]
fn a_range_is_one_reference_rather_than_two() {
    let Expr::Reference(reference) = parsed("A1:B3") else {
        panic!("not a reference")
    };

    match reference.kind {
        ReferenceKind::Range { from, to } => {
            assert_eq!((from.0.index, from.1.index), (0, 0));
            assert_eq!((to.0.index, to.1.index), (2, 1));
        }
        other => panic!("not a range: {other:?}"),
    }
}

#[test]
fn a_whole_column_is_not_a_range_with_a_million_rows() {
    // Excel writes `A:A` and means "this column, however far it reaches".
    let Expr::Reference(reference) = parsed("A:C") else {
        panic!("not a reference")
    };
    assert!(matches!(reference.kind, ReferenceKind::Columns { .. }));

    let Expr::Reference(rows) = parsed("2:5") else {
        panic!("not a reference")
    };
    assert!(matches!(rows.kind, ReferenceKind::Rows { .. }));
}

#[test]
fn a_sheet_name_comes_with_the_reference() {
    let Expr::Reference(reference) = parsed("Notes!A1") else {
        panic!("not a reference")
    };
    assert_eq!(
        reference.sheet,
        Some(("Notes".to_string(), "Notes".to_string()))
    );
}

#[test]
fn a_sheet_name_with_spaces_in_it_is_quoted() {
    let Expr::Reference(reference) = parsed("'Two words'!B2") else {
        panic!("not a reference")
    };
    assert_eq!(
        reference.sheet,
        Some(("Two words".to_string(), "Two words".to_string()))
    );
}

#[test]
fn a_reference_can_cross_three_sheets_at_once() {
    let Expr::Reference(reference) = parsed("Sheet1:Sheet3!A1") else {
        panic!("not a reference")
    };
    assert_eq!(
        reference.sheet,
        Some(("Sheet1".to_string(), "Sheet3".to_string()))
    );
}

#[test]
fn multiplication_binds_tighter_than_addition() {
    let expression = parsed("2*3+4");
    let (operator, left, _) = binary(&expression);

    assert_eq!(operator, Operator::Add);
    assert!(matches!(
        left,
        Expr::Binary {
            operator: Operator::Multiply,
            ..
        }
    ));
}

#[test]
fn comparison_binds_more_loosely_than_arithmetic() {
    let expression = parsed("A1+1>B1");
    let (operator, left, _) = binary(&expression);

    assert_eq!(operator, Operator::Greater);
    assert!(matches!(
        left,
        Expr::Binary {
            operator: Operator::Add,
            ..
        }
    ));
}

#[test]
fn the_power_operator_groups_to_the_left_as_excel_does() {
    // 2^3^2 is 64 in a spreadsheet and 512 in mathematics; being right about
    // the spreadsheet is the bar.
    let expression = parsed("2^3^2");
    let (operator, left, _) = binary(&expression);

    assert_eq!(operator, Operator::Power);
    assert!(matches!(
        left,
        Expr::Binary {
            operator: Operator::Power,
            ..
        }
    ));
}

#[test]
fn a_minus_in_front_is_not_a_subtraction() {
    assert_eq!(
        parsed("-A1"),
        Expr::Unary {
            negative: true,
            operand: Box::new(Expr::Reference(Reference::cell(0, 0)))
        }
    );
}

#[test]
fn a_percentage_applies_to_what_is_before_it() {
    assert_eq!(parsed("50%"), Expr::Percent(Box::new(Expr::Number(50.0))));
}

#[test]
fn a_call_is_a_name_with_a_bracket_after_it() {
    assert_eq!(
        parsed("SUM(1,2)"),
        Expr::Call {
            name: "SUM".to_string(),
            arguments: vec![Expr::Number(1.0), Expr::Number(2.0)],
        }
    );
}

#[test]
fn a_function_nobody_here_knows_still_parses() {
    // It becomes `#NAME?` when it is worked out, and goes back into the file
    // as it came — a workbook using something unimplemented is not a workbook
    // this damages.
    let Expr::Call { name, arguments } = parsed("FORECAST.ETS(A1,B1:B9,C1:C9)") else {
        panic!("not a call")
    };

    assert_eq!(name, "FORECAST.ETS");
    assert_eq!(arguments.len(), 3);
}

#[test]
fn the_prefix_excel_writes_for_newer_functions_is_part_of_the_name() {
    let Expr::Call { name, .. } = parsed("_xlfn.XLOOKUP(A1,B:B,C:C)") else {
        panic!("not a call")
    };
    assert_eq!(name, "_xlfn.XLOOKUP");
}

#[test]
fn an_argument_left_out_is_still_an_argument() {
    // `IF(A1,,2)` has three; dropping the gap would move the third into the
    // second's place.
    let Expr::Call { arguments, .. } = parsed("IF(A1,,2)") else {
        panic!("not a call")
    };

    assert_eq!(arguments.len(), 3);
    assert_eq!(arguments[1], Expr::Blank);
}

#[test]
fn a_call_with_no_arguments_has_none_rather_than_one_empty_one() {
    let Expr::Call { arguments, .. } = parsed("TODAY()") else {
        panic!("not a call")
    };
    assert!(arguments.is_empty());
}

#[test]
fn an_array_is_rows_of_values() {
    let Expr::Array(rows) = parsed("{1,2;3,4}") else {
        panic!("not an array")
    };

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], vec![Expr::Number(1.0), Expr::Number(2.0)]);
}

#[test]
fn brackets_are_kept_so_the_formula_can_be_written_back() {
    assert!(
        matches!(parsed("(1+2)*3"), Expr::Binary { left, .. } if matches!(*left, Expr::Parenthesised(_)))
    );
}

#[test]
fn a_space_between_two_references_is_an_operator() {
    let expression = parsed("A1:B5 B1:C9");
    let (operator, _, _) = binary(&expression);
    assert_eq!(operator, Operator::Intersect);
}

#[test]
fn a_space_around_an_operator_is_only_spacing() {
    assert_eq!(parsed("1 + 2"), parsed("1+2"));
    assert_eq!(parsed(" SUM( A1 , B1 ) "), parsed("SUM(A1,B1)"));
}

#[test]
fn a_formula_that_is_not_one_says_where_it_went_wrong() {
    assert!(parse("SUM(1,").is_err());
    assert!(parse("(1+2").is_err());
    assert!(parse("1 2 3").is_err());
}
