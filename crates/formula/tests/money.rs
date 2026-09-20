//! Money over time, against Excel's own documented answers.
//!
//! Every expected value here is one Microsoft prints beside the function it
//! belongs to, which makes them the closest thing to an authority there is
//! short of the product itself.
//!
//! The sign convention is the thing to keep in mind while reading: money
//! going out is negative. A loan is a positive amount received and a column
//! of negative payments, and `PMT` answers with a negative number because a
//! payment is money leaving.

mod common;

use common::{on, Sheet};
use formula::value::{Error, Value};

fn answer(formula: &str) -> Value {
    on(&Sheet::default(), formula)
}

fn number(formula: &str) -> f64 {
    match answer(formula) {
        Value::Number(value) => value,
        other => panic!("{formula} is not a number: {other:?}"),
    }
}

/// Compared to the penny, which is as far as a printed example goes.
fn penny(formula: &str, expected: f64) {
    let found = number(formula);
    assert!(
        (found - expected).abs() < 0.005,
        "{formula} is {found}, not {expected}"
    );
}

fn close(formula: &str, expected: f64, within: f64) {
    let found = number(formula);
    assert!(
        (found - expected).abs() < within,
        "{formula} is {found}, not {expected}"
    );
}

#[test]
fn pmt_answers_with_what_leaves_the_account() {
    penny("PMT(0.08/12,10,10000)", -1037.03);
    // Paid at the beginning of the month instead, which saves a month of
    // interest on every payment.
    penny("PMT(0.08/12,10,10000,0,1)", -1030.16);
    penny("PMT(0,10,10000)", -1000.0);
    // A savings plan is the same arithmetic read backwards: what to put by
    // each month to arrive at a sum.
    penny("PMT(0.06/12,18*12,0,50000)", -129.08);
    assert!(number("PMT(0.08/12,10,10000)") < 0.0);
}

#[test]
fn pv_and_fv_are_the_same_question_from_either_end() {
    penny("PV(0.08/12,12*20,500,0,0)", -59_777.15);
    penny("FV(0.06/12,10,-200,-500,1)", 2581.40);
    penny("FV(0.12/12,12,-1000)", 12_682.50);
    penny("PV(0,10,-100)", 1000.0);
    penny("FV(0,10,-100)", 1000.0);
}

#[test]
fn nper_counts_the_payments_and_says_when_there_are_none() {
    close("NPER(0.12/12,-100,-1000,10000,1)", 59.67, 0.01);
    penny("NPER(0,-100,1000)", 10.0);
    // A debt whose payments never cover the interest is never paid off, and
    // there is no number of payments to give.
    assert_eq!(answer("NPER(0.1,-1,1000)"), Value::Error(Error::Number));
    assert_eq!(answer("NPER(0,0,1000)"), Value::Error(Error::Number));
}

#[test]
fn rate_is_searched_for_rather_than_worked_out() {
    // There is no closed form, so it is the rate that makes the payments and
    // the sums agree — found by getting closer.
    close("RATE(48,-200,8000)", 0.007_701, 0.000_01);
    close("RATE(48,-200,8000)*12", 0.0924, 0.0001);
    // Four payments of a thousand against three thousand borrowed: the rate
    // where the annuity factor `(1-(1+r)^-4)/r` is exactly 3.
    close("RATE(4,-1000,3000)", 0.125_898, 0.000_01);
    close("RATE(10,-100,1000,0,0,0.2)", 0.0, 0.000_001);
}

#[test]
fn the_two_halves_of_a_payment_add_up_to_the_payment() {
    // Nearly all interest at the start of a mortgage and nearly all capital
    // at the end: the fact these two exist to show.
    penny("IPMT(0.1/12,1,3*12,8000)", -66.67);
    penny("IPMT(0.1,3,3,8000)", -292.45);
    penny("PPMT(0.1/12,1,2*12,2000)", -75.62);
    penny("PPMT(0.08,10,10,200000)", -27_598.05);

    close(
        "IPMT(0.08/12,1,360,200000)+PPMT(0.08/12,1,360,200000)",
        number("PMT(0.08/12,360,200000)"),
        0.000_001,
    );
    // A payment made at the beginning of the first period has had no time to
    // earn interest, so none of it is interest.
    assert_eq!(number("IPMT(0.1,1,3,8000,0,1)"), 0.0);
    assert_eq!(answer("IPMT(0.1,4,3,8000)"), Value::Error(Error::Number));
}

#[test]
fn npv_discounts_the_first_amount_by_a_whole_period() {
    // Which is why an investment made today is added outside the function
    // rather than passed to it: `NPV` holds that everything it is given
    // happens at the end of a period.
    penny("NPV(0.1,-10000,3000,4200,6800)", 1188.44);
    // The same figures with the cost taken out and subtracted afterwards are
    // a different number, because the cost is then at time nought rather
    // than a year in. Both are right; they are answers to different
    // questions, and the argument list is where the question is asked.
    penny("-10000+NPV(0.1,3000,4200,6800)", 1307.29);
    penny("NPV(0,100,100)", 200.0);
    assert_eq!(answer("NPV(-1,100)"), Value::Error(Error::Number));
}

#[test]
fn irr_is_the_rate_at_which_a_venture_comes_to_nothing() {
    // And here the first amount *is* at time nought, which is the opposite of
    // `NPV`'s rule about the same list. Excel has both.
    close("IRR({-70000;12000;15000;18000;21000})", -0.0212, 0.000_1);
    close(
        "IRR({-70000;12000;15000;18000;21000;26000})",
        0.0866,
        0.000_1,
    );
    close("IRR({-70000;12000;15000},-0.1)", -0.4435, 0.001);
    // Money that only ever comes in has no rate that brings it to nothing.
    assert_eq!(answer("IRR({100;200})"), Value::Error(Error::Number));
}

#[test]
fn the_dated_pair_count_days_rather_than_periods() {
    let values = "{-10000;2750;4250;3250;2750}";
    let dates = concat!(
        "{DATE(2008,1,1);DATE(2008,3,1);DATE(2008,10,30);",
        "DATE(2009,2,15);DATE(2009,4,1)}"
    );

    penny(&format!("XNPV(0.09,{values},{dates})"), 2086.65);
    close(&format!("XIRR({values},{dates})"), 0.373_362_5, 0.000_01);
    // A year is three hundred and sixty-five days here whatever the calendar
    // says about leap years, which is the convention the function is defined
    // by rather than an approximation.
    penny(
        "XNPV(0.1,{-100;110},{DATE(2024,1,1);DATE(2025,1,1)})",
        -0.03,
    );
}

#[test]
fn straight_line_depreciation_is_the_same_amount_every_year() {
    assert_eq!(number("SLN(30000,7500,10)"), 2250.0);
    assert_eq!(number("SLN(10000,0,5)"), 2000.0);
    assert_eq!(number("SLN(10000,10000,5)"), 0.0);
    assert_eq!(answer("SLN(1000,100,0)"), Value::Error(Error::DivideByZero));
}

#[test]
fn declining_balance_takes_most_of_it_in_the_first_year() {
    // The rate is rounded to three decimals before anything is worked out,
    // and every later year is calculated from the rounded one — so the
    // rounding is part of the answer rather than a tidy-up of it.
    penny("DB(1000000,100000,6,1,7)", 186_083.33);
    penny("DB(1000000,100000,6,2,7)", 259_639.42);
    penny("DB(1000000,100000,6,3,7)", 176_814.44);
    // The stub at the end, which is what the months of the first year did not
    // use up.
    penny("DB(1000000,100000,6,7,7)", 15_845.10);
    assert_eq!(
        answer("DB(1000000,100000,6,8,7)"),
        Value::Error(Error::Number)
    );
}
