//! Angles, and moving a number to a multiple of another.
//!
//! Every expectation here was taken out of the corpus rather than worked out:
//! `poi test-data/spreadsheet/FormulaEvalTestData.xlsx` for the angles and
//! `sc/qa/unit/data/xlsx/ceiling-floor.xlsx` for the rest, both of which are
//! sheets of nothing but these calls with the answers Excel cached beside
//! them. Where a number is written to fifteen digits it is the number in the
//! file; where it is exact it is exact in the file too.
//!
//! `MROUND` is the one exception and says so where it is tested: no workbook
//! in the corpus calls it, so those expectations come from the function's
//! documented behaviour instead.

// The numbers below are the ones the workbooks hold, digit for digit, and
// several of them carry a digit more than a double can keep. Trimming them to
// what fits would be quietly rewriting the evidence.
#![allow(clippy::excessive_precision)]
// And one of them is π/2 to the digit, which clippy would rather see written
// as the constant. It is written here as the file writes it, for the same
// reason.
#![allow(clippy::approx_constant)]

mod common;

use common::Sheet;
use formula::value::{Error, Value};
use formula::{evaluate, parse, Context};

/// A formula worked out against a sheet, the way a file's formula is.
fn on(sheet: &Sheet, formula: &str) -> Value {
    let tree = parse(formula).unwrap_or_else(|error| panic!("{formula} did not parse: {error}"));
    evaluate(
        &tree,
        &Context {
            cells: sheet,
            at: (0, 0),
            intersect: false,
            ranges_wanted: false,
        },
    )
}

fn answer(formula: &str) -> Value {
    on(&Sheet::default(), formula)
}

fn number(formula: &str) -> f64 {
    match answer(formula) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

/// Close enough to be the same number written down to fifteen digits.
fn near(formula: &str, expected: f64) {
    let got = number(formula);
    assert!(
        (got - expected).abs() <= 1e-12 * expected.abs().max(1.0),
        "{formula} came to {got}, and the file says {expected}"
    );
}

mod angles {
    use super::*;

    #[test]
    fn sine_of_what_the_file_holds() {
        near("SIN(0)", 0.0);
        near("SIN(1)", 0.8414709848078965);
        near("SIN(2)", 0.90929742682568171);
        near("SIN(-534)", 7.0692098333373365e-2);
        near("SIN(1.1)", 0.89120736006143542);
    }

    #[test]
    fn cosine_and_tangent() {
        near("COS(0)", 1.0);
        near("COS(1)", 0.5403023058681398);
        near("TAN(0)", 0.0);
        near("TAN(1)", 1.5574077246549023);
        near("TAN(1.1)", 1.9647596572486523);
        near("TAN(-2)", 2.1850398632615189);
    }

    #[test]
    fn the_inverse_ones_have_an_edge_and_say_so() {
        // `ASIN(534)` and `ACOS(2)` are `#NUM!` in the file: there is no angle
        // whose sine is 534.
        near("ASIN(0)", 0.0);
        near("ASIN(1)", 1.5707963267948966);
        near("ACOS(1)", 0.0);
        near("ACOS(0)", 1.5707963267948966);
        assert_eq!(answer("ASIN(534)"), Value::Error(Error::Number));
        assert_eq!(answer("ASIN(-534)"), Value::Error(Error::Number));
        assert_eq!(answer("ACOS(2)"), Value::Error(Error::Number));
    }

    #[test]
    fn arctangent_and_the_hyperbolic_one() {
        near("ATAN(0)", 0.0);
        near("ATAN(1)", 0.7853981633974483);
        near("ATAN(534)", 1.5689236698079085);
        near("ASINH(0)", 0.0);
        near("ASINH(1)", 0.88137358701954294);
        near("ASINH(9999999999)", 23.718998110400403);
        near("ASINH(-534)", -6.9735438962320844);
    }

    #[test]
    fn degrees_and_radians_are_each_other() {
        near("RADIANS(0)", 0.0);
        near("RADIANS(1)", 1.7453292519943295e-2);
        near("RADIANS(2)", 3.4906585039886591e-2);
        near("RADIANS(-2)", -3.4906585039886591e-2);
        near("RADIANS(-1)", -1.7453292519943295e-2);
        near("DEGREES(1)", 57.295779513082323);
        near("DEGREES(-534)", -30595.946259985962);
        near("DEGREES(0)", 0.0);
    }

    /// `EverythingTests` holds 0, 1, 2, −534, −1 and −9999999999 in the cells
    /// these call, and the answers below are the ones cached beside them.
    #[test]
    fn the_hyperbolic_ones_and_where_they_stop() {
        near("SINH(0)", 0.0);
        near("COSH(0)", 1.0);
        near("TANH(0)", 0.0);
        near("SINH(1)", 1.1752011936438014);
        near("COSH(1)", 1.5430806348152437);
        near("TANH(1)", 0.76159415595576485);

        // `cosh` never goes under 1, so its inverse has nothing below it.
        near("ACOSH(1)", 0.0);
        near("ACOSH(2)", 1.3169578969248166);
        assert_eq!(answer("ACOSH(-534)"), Value::Error(Error::Number));
        assert_eq!(answer("ACOSH(-9999999999)"), Value::Error(Error::Number));

        // And `tanh` never reaches 1.
        near("ATANH(0)", 0.0);
        assert_eq!(answer("ATANH(1)"), Value::Error(Error::Number));
        assert_eq!(answer("ATANH(-534)"), Value::Error(Error::Number));
        assert_eq!(answer("ATANH(1.1)"), Value::Error(Error::Number));
    }

    #[test]
    fn the_angle_to_a_point_takes_x_first_and_refuses_the_origin() {
        // Excel's argument order is the other way round from every language:
        // `ATAN2(x, y)`. And both of them nothing is `#DIV/0!`, which is the
        // answer the file holds rather than an angle of nought.
        near("ATAN2(0,1)", 1.5707963267948966);
        near("ATAN2(1,1)", 0.78539816339744828);
        near("ATAN2(-1,1)", 2.3561944901923448);
        assert_eq!(answer("ATAN2(0,0)"), Value::Error(Error::DivideByZero));
    }

    #[test]
    fn a_number_written_down_is_a_number_and_one_pointed_at_may_not_be() {
        // Excel's asymmetry, and both halves are in the file: `COS("1")` is
        // 0.5403, and `SIN(B18)` where B18 holds TRUE is `#VALUE!`.
        let sheet = Sheet::with(&[
            ("B18", Value::Bool(true)),
            ("E7", Value::Text(String::new())),
            ("E15", Value::Number(1.0)),
        ]);

        near("COS(\"1\")", 0.5403023058681398);
        assert_eq!(on(&sheet, "SIN(B18)"), Value::Error(Error::Value));
        assert_eq!(on(&sheet, "ATAN(E7)"), Value::Error(Error::Value));
        assert_eq!(on(&sheet, "COS(E15)"), Value::Number(0.5403023058681398));
        // A cell with nothing in it is nothing, which is a number.
        assert_eq!(on(&sheet, "COS(D7)"), Value::Number(1.0));
    }
}

/// `ceiling-floor.xlsx` holds 23.5 in `C1` and −23.5 in `D1`, and a column of
/// significances: 1 in `A3`, 0 in `A4`, −1 in `A5`. Every row of it is one of
/// these functions over that pair, and the answers below are the file's.
mod multiples {
    use super::*;

    #[test]
    fn the_default_is_along_the_number_line() {
        assert_eq!(answer("FLOOR.MATH(23.5)"), Value::Number(23.0));
        assert_eq!(answer("FLOOR.MATH(-23.5)"), Value::Number(-24.0));
        assert_eq!(answer("CEILING.MATH(23.5)"), Value::Number(24.0));
        assert_eq!(answer("CEILING.MATH(-23.5)"), Value::Number(-23.0));
    }

    #[test]
    fn a_significance_of_nothing_is_nothing() {
        assert_eq!(answer("FLOOR.MATH(23.5,0)"), Value::Number(0.0));
        assert_eq!(answer("FLOOR.MATH(-23.5,0)"), Value::Number(0.0));
        assert_eq!(answer("CEILING.MATH(23.5,0)"), Value::Number(0.0));
        assert_eq!(answer("CEILING.MATH(-23.5,0)"), Value::Number(0.0));
        assert_eq!(answer("FLOOR.PRECISE(23.5,0)"), Value::Number(0.0));
        assert_eq!(answer("ISO.CEILING(23.5,0)"), Value::Number(0.0));
    }

    #[test]
    fn the_significances_own_sign_is_ignored() {
        assert_eq!(answer("FLOOR.MATH(23.5,-1)"), Value::Number(23.0));
        assert_eq!(answer("FLOOR.MATH(-23.5,-1)"), Value::Number(-24.0));
        assert_eq!(answer("CEILING.MATH(23.5,-1)"), Value::Number(24.0));
        assert_eq!(answer("CEILING.MATH(-23.5,-1)"), Value::Number(-23.0));
        assert_eq!(answer("FLOOR.PRECISE(-23.5,-1)"), Value::Number(-24.0));
        assert_eq!(answer("CEILING.PRECISE(-23.5,-1)"), Value::Number(-23.0));
    }

    #[test]
    fn the_mode_turns_a_negative_number_round_and_nothing_else() {
        // Zero is the default written out.
        assert_eq!(answer("FLOOR.MATH(-23.5,1,0)"), Value::Number(-24.0));
        assert_eq!(answer("CEILING.MATH(-23.5,1,0)"), Value::Number(-23.0));

        // Anything else faces it toward zero, and `CEILING` away from it.
        assert_eq!(answer("FLOOR.MATH(-23.5,1,1)"), Value::Number(-23.0));
        assert_eq!(answer("FLOOR.MATH(-23.5,-1,1)"), Value::Number(-23.0));
        assert_eq!(answer("CEILING.MATH(-23.5,1,1)"), Value::Number(-24.0));
        assert_eq!(answer("CEILING.MATH(-23.5,-1,1)"), Value::Number(-24.0));

        // A positive number does not care what the mode says.
        assert_eq!(answer("FLOOR.MATH(23.5,-1,-1)"), Value::Number(23.0));
        assert_eq!(answer("FLOOR.MATH(-23.5,-1,-1)"), Value::Number(-23.0));
    }

    #[test]
    fn the_precise_pair_have_no_mode_at_all() {
        assert_eq!(answer("FLOOR.PRECISE(23.5)"), Value::Number(23.0));
        assert_eq!(answer("FLOOR.PRECISE(-23.5)"), Value::Number(-24.0));
        assert_eq!(answer("CEILING.PRECISE(23.5)"), Value::Number(24.0));
        assert_eq!(answer("CEILING.PRECISE(-23.5)"), Value::Number(-23.0));
        assert_eq!(answer("ISO.CEILING(23.5)"), Value::Number(24.0));
        assert_eq!(answer("ISO.CEILING(-23.5)"), Value::Number(-23.0));

        // A number already on a multiple stays where it is.
        assert_eq!(answer("FLOOR.PRECISE(23)"), Value::Number(23.0));
        assert_eq!(answer("FLOOR.PRECISE(-23)"), Value::Number(-23.0));
        // And one under its first multiple falls to nothing.
        assert_eq!(answer("FLOOR.PRECISE(1.5,2)"), Value::Number(0.0));
        assert_eq!(answer("CEILING.PRECISE(2,4)"), Value::Number(4.0));
        assert_eq!(
            answer("ISO.CEILING(2,0.13333333333333333)"),
            Value::Number(2.0)
        );
    }

    #[test]
    fn even_and_odd_go_away_from_zero() {
        assert_eq!(answer("EVEN(0)"), Value::Number(0.0));
        assert_eq!(answer("EVEN(1.1)"), Value::Number(2.0));
        assert_eq!(answer("EVEN(-1.00001)"), Value::Number(-2.0));
        assert_eq!(answer("EVEN(-0.00001)"), Value::Number(-2.0));
        assert_eq!(answer("EVEN(3)"), Value::Number(4.0));
        assert_eq!(answer("EVEN(2)"), Value::Number(2.0));

        // Nothing is already even and is not already odd, which is the pair's
        // one disagreement.
        assert_eq!(answer("ODD(0)"), Value::Number(1.0));
        assert_eq!(answer("ODD(1)"), Value::Number(1.0));
        assert_eq!(answer("ODD(-0.00001)"), Value::Number(-1.0));
        assert_eq!(answer("ODD(-534)"), Value::Number(-535.0));
        assert_eq!(answer("ODD(2)"), Value::Number(3.0));
    }

    #[test]
    fn factorials_throw_the_fraction_away() {
        assert_eq!(answer("FACT(0)"), Value::Number(1.0));
        assert_eq!(answer("FACT(1)"), Value::Number(1.0));
        assert_eq!(answer("FACT(2)"), Value::Number(2.0));
        assert_eq!(answer("FACT(2.99999)"), Value::Number(2.0));
        assert_eq!(answer("FACT(15)"), Value::Number(1_307_674_368_000.0));
        assert_eq!(answer("FACT(-1)"), Value::Error(Error::Number));
    }

    /// The one set of expectations not taken from a corpus file — no workbook
    /// in it calls `MROUND` — so these are the documented behaviour instead,
    /// and are worth checking against a real Excel when one is to hand.
    #[test]
    fn mround_goes_to_the_nearest_multiple_with_a_half_away_from_zero() {
        assert_eq!(answer("MROUND(10,3)"), Value::Number(9.0));
        assert_eq!(answer("MROUND(-10,-3)"), Value::Number(-9.0));
        assert_eq!(answer("MROUND(1.3,0.2)"), Value::Number(1.4000000000000001));
        assert_eq!(answer("MROUND(5,2)"), Value::Number(6.0));
        assert_eq!(answer("MROUND(10,0)"), Value::Number(0.0));
        // A multiple facing the other way has none near the number.
        assert_eq!(answer("MROUND(10,-3)"), Value::Error(Error::Number));
    }
}
