//! What a spreadsheet does about the arithmetic it cannot do exactly.
//!
//! A double holds about seventeen significant digits and a spreadsheet shows
//! fifteen, and the gap between those two numbers is where every complaint
//! about a total reading `-2.22044604925031E-16` comes from. Excel narrows
//! the gap with two rules, and this file is those two rules.
//!
//! **Where the expectations come from.** Two places, and the difference
//! matters.
//!
//! The corpus settles one thing and only one: `AVERAGE(B7:C15,B16:C17,D8:D16)`
//! in POI's `FormulaEvalTestData.xlsx` runs over a column holding ten
//! thousand million and minus ten thousand million, which cancel and leave a
//! crumb. Excel cached -4.0893554731909327E-9 for it. So Excel does **not**
//! tidy a column added up by a function, however much it looks as though it
//! should — and an earlier draft of this file asserted that it did, on the
//! reasoning that `SUM(a,b,-a,-b)` cannot answer differently from
//! `a+b-a-b`. It can, and it does, and that one cell said so.
//!
//! Everything else here is Microsoft's published examples for the
//! subtraction rule, which is the best authority available in this room and
//! is not a real Excel. Nothing in the corpus exercises them: those workbooks
//! are tables of function calls rather than ledgers that have been added up
//! and subtracted from.
//!
//! See `apps/sheets/docs/adr/0004-precision.md`.

// 3.142 and 3.141 are what `ROUNDUP` and `ROUNDDOWN` answer for 3.14159, and
// clippy sees an approximation of pi. They are the answers, not the constant.
#![allow(clippy::approx_constant)]

mod common;

use common::Sheet;
use formula::value::Value;
use formula::{evaluate, parse, Context};

fn answer(formula: &str) -> Value {
    let sheet = Sheet::default();
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(
        &tree,
        &Context {
            cells: &sheet,
            at: (0, 0),
            intersect: false,
            ranges_wanted: false,
        },
    )
}

fn number(formula: &str) -> f64 {
    match answer(formula) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

/// Excel's rule for a subtraction whose operands are close.
///
/// Microsoft's published examples for it.
mod what_is_left_of_a_subtraction {
    use super::number;

    #[test]
    fn a_column_that_cancels_comes_to_nothing() {
        assert_eq!(number("1.333+1.225-1.333-1.225"), 0.0);
        assert_eq!(number("0.1+0.2-0.3"), 0.0);
        assert_eq!(number("0.5-0.4-0.1"), 0.0);
    }

    #[test]
    fn the_correction_is_the_last_step_and_not_the_whole_sum() {
        // Subtract first and the error is carried into what follows, where
        // nothing takes it back out again. This is the example Microsoft
        // gives for why the rule does not tidy everything.
        assert_eq!(number("(43.1-43.2)+1"), 0.899_999_999_999_999);
    }

    #[test]
    fn a_difference_that_is_a_real_number_is_kept() {
        // The rule is about relative size. A millionth beside a millionth is
        // the answer; a millionth beside a million is the representation.
        assert_eq!(number("0.000001-0.0000005"), 0.000_000_5);
        assert_eq!(number("1-0.9"), 0.1);
    }

    #[test]
    fn a_number_that_needs_a_sixteenth_digit_does_not_get_one() {
        // Fifteen significant digits is what a spreadsheet keeps, so the
        // sixteenth is rounded away rather than shown.
        assert_eq!(number("1E15+1-1E15"), 0.0);
    }
}

/// The same arithmetic, written the two ways a spreadsheet allows — which do
/// not agree, and are not meant to.
///
/// This is the one part of this file the corpus decided.
mod two_spellings_of_one_sum {
    use super::number;

    #[test]
    fn the_operators_tidy_up_and_the_function_does_not() {
        // The same four numbers. The correction belongs to the subtraction
        // operator, and `SUM` does not subtract — it adds a column, and what
        // the column leaves behind is what it leaves behind.
        assert_eq!(number("1.333+1.225-1.333-1.225"), 0.0);
        assert_ne!(number("SUM(1.333,1.225,-1.333,-1.225)"), 0.0);
    }

    #[test]
    fn a_column_that_cancels_keeps_its_crumb() {
        // POI's FormulaEvalTestData.xlsx, cell D180: an average over a column
        // holding 9999999999 and -9999999999 among smaller numbers. Excel
        // cached -4.0893554731909327E-9 rather than nought, which is how we
        // know the rule stops where it stops.
        let crumb = number("SUM(9999999999,1.1,-9999999999,-1.1)");
        assert_ne!(crumb, 0.0);
        assert!(crumb.abs() < 1e-6, "{crumb} is bigger than a crumb");
        // And it is a crumb the rule would have swallowed had it been
        // allowed near this: a part in twenty-six thousand million.
        assert!(crumb.abs() / 9_999_999_999.0 < 1e-15);
    }

    #[test]
    fn a_column_that_does_not_cancel_keeps_what_it_has() {
        // Neither spelling tidies a total that is genuinely a hair off: a
        // tenth and two tenths and three tenths is not six tenths in either
        // program.
        assert_eq!(number("SUM(0.1,0.2,0.3)"), number("0.1+0.2+0.3"));
        assert_ne!(number("SUM(0.1,0.2,0.3)"), 0.6);
    }
}

/// `ROUND` and the family around it.
///
/// Rounded half away from zero, and rounded on the number as it is written
/// rather than on the double behind it — which is the whole difference
/// between a spreadsheet and every programming language.
mod rounding {
    use super::number;

    #[test]
    fn half_goes_away_from_zero_and_not_to_even() {
        assert_eq!(number("ROUND(2.5,0)"), 3.0);
        assert_eq!(number("ROUND(-2.5,0)"), -3.0);
        assert_eq!(number("ROUND(1.5,0)"), 2.0);
        assert_eq!(number("ROUND(0.5,0)"), 1.0);
    }

    #[test]
    fn a_half_that_is_not_quite_a_half_is_rounded_as_though_it_were() {
        // 2.675 is 2.67499999999999982... as a double, and every language
        // gives 2.67. A spreadsheet reads the number somebody typed, which
        // has fifteen digits and ends in a five.
        assert_eq!(number("ROUND(2.675,2)"), 2.68);
        assert_eq!(number("ROUND(1.005,2)"), 1.01);
        assert_eq!(number("ROUND(-1.005,2)"), -1.01);
        assert_eq!(number("ROUND(8.635,2)"), 8.64);
    }

    #[test]
    fn a_sixteenth_digit_is_not_there_to_round_on() {
        // 1.0049999999999999 has seventeen digits; a spreadsheet keeps
        // fifteen, which makes it 1.005 and rounds up.
        assert_eq!(number("ROUND(1.0049999999999999,2)"), 1.01);
    }

    #[test]
    fn a_negative_place_rounds_to_the_left_of_the_point() {
        assert_eq!(number("ROUND(1234.5678,-2)"), 1200.0);
        assert_eq!(number("ROUND(1234.5678,-4)"), 0.0);
    }

    #[test]
    fn up_and_down_ignore_the_half_and_mind_the_sign() {
        assert_eq!(number("ROUNDUP(3.14159,3)"), 3.142);
        assert_eq!(number("ROUNDDOWN(3.14159,3)"), 3.141);
        // Away from zero and towards it, which is not the same as bigger and
        // smaller once the number is negative.
        assert_eq!(number("ROUNDUP(-3.14159,3)"), -3.142);
        assert_eq!(number("ROUNDDOWN(-3.14159,3)"), -3.141);
    }

    #[test]
    fn trunc_and_int_part_company_below_zero() {
        // `TRUNC` drops what is after the point; `INT` goes to the number
        // below, which for a negative is further from zero.
        assert_eq!(number("TRUNC(8.9)"), 8.0);
        assert_eq!(number("TRUNC(-8.9)"), -8.0);
        assert_eq!(number("INT(8.9)"), 8.0);
        assert_eq!(number("INT(-8.1)"), -9.0);
    }
}
