//! The functions, against Excel's answers.
//!
//! Every expected value here is what Excel gives for the same formula. The
//! ones worth reading twice are where a language's own library disagrees:
//! `ROUND(2.5,0)` is 3 rather than 2, `MOD(-3,2)` is 1 rather than -1,
//! `INT(-2.5)` is -3 rather than -2, and `SUM` over a range ignores the words
//! in it while `SUM("5")` adds five.

mod common;

use common::{column, number, on, text, value, Sheet};
use formula::value::{Error, Value};

#[test]
fn sum_adds_the_numbers_and_ignores_the_heading() {
    let sheet = column();

    assert_eq!(on(&sheet, "SUM(A1:A5)"), Value::Number(60.0));
    assert_eq!(on(&sheet, "SUM(A2:A3)"), Value::Number(30.0));
    assert_eq!(on(&sheet, "SUM(A2:A3,A5)"), Value::Number(60.0));
    assert_eq!(number("SUM(1,2,3)"), 6.0);
    assert_eq!(number("SUM(1.5,-0.5)"), 1.0);
}

#[test]
fn sum_of_an_error_is_that_error() {
    let sheet = Sheet::with(&[("A1", Value::Error(Error::DivideByZero))]);
    assert_eq!(on(&sheet, "SUM(A1:A2)"), Value::Error(Error::DivideByZero));
}

#[test]
fn product_multiplies() {
    assert_eq!(number("PRODUCT(2,3,4)"), 24.0);
    assert_eq!(number("PRODUCT(2,0)"), 0.0);
    assert_eq!(number("PRODUCT(-2,3)"), -6.0);
    assert_eq!(number("PRODUCT(1.5,2)"), 3.0);

    let sheet = column();
    assert_eq!(on(&sheet, "PRODUCT(A2:A3)"), Value::Number(200.0));
}

#[test]
fn round_goes_half_away_from_zero() {
    // Which is what everybody was taught and what every invoice assumes; the
    // language's own library rounds to even.
    assert_eq!(number("ROUND(2.5,0)"), 3.0);
    assert_eq!(number("ROUND(-2.5,0)"), -3.0);
    // 1.005 is 1.00499999999999989 in binary; Excel rounds the number a
    // spreadsheet keeps rather than the one the machine holds.
    assert_eq!(number("ROUND(1.005,2)"), 1.01);
    assert_eq!(number("ROUND(1234.5678,-2)"), 1200.0);
    assert_eq!(number("ROUND(0.5,0)"), 1.0);
}

#[test]
fn rounding_up_and_down_ignore_which_half_it_is_in() {
    assert_eq!(number("ROUNDUP(2.1,0)"), 3.0);
    assert_eq!(number("ROUNDUP(-2.1,0)"), -3.0);
    assert_eq!(number("ROUNDDOWN(2.9,0)"), 2.0);
    assert_eq!(number("ROUNDDOWN(-2.9,0)"), -2.0);
    assert_eq!(number("ROUNDUP(1.001,2)"), 1.01);
}

#[test]
fn int_goes_downwards_even_for_a_negative() {
    assert_eq!(number("INT(2.9)"), 2.0);
    assert_eq!(number("INT(-2.5)"), -3.0);
    assert_eq!(number("INT(5)"), 5.0);
    assert_eq!(number("INT(-0.5)"), -1.0);
    assert_eq!(number("TRUNC(-2.5)"), -2.0);
}

#[test]
fn mod_takes_the_sign_of_the_divisor() {
    // The opposite of what the language's own operator gives.
    assert_eq!(number("MOD(7,3)"), 1.0);
    assert_eq!(number("MOD(-3,2)"), 1.0);
    assert_eq!(number("MOD(3,-2)"), -1.0);
    assert_eq!(number("MOD(7.5,2)"), 1.5);
    assert_eq!(value("MOD(1,0)"), Value::Error(Error::DivideByZero));
}

#[test]
fn the_ordinary_arithmetic_functions() {
    assert_eq!(number("ABS(-3)"), 3.0);
    assert_eq!(number("SQRT(9)"), 3.0);
    assert_eq!(value("SQRT(-1)"), Value::Error(Error::Number));
    assert_eq!(number("POWER(2,10)"), 1024.0);
    assert_eq!(number("SIGN(-42)"), -1.0);
    assert!((number("PI()") - std::f64::consts::PI).abs() < 1e-12);
}

#[test]
fn the_logarithms_say_when_there_is_no_answer() {
    assert_eq!(number("LOG10(1000)"), 3.0);
    assert_eq!(number("LOG(8,2)"), 3.0);
    assert_eq!(number("LOG(100)"), 2.0);
    assert!((number("LN(EXP(1))") - 1.0).abs() < 1e-12);
    assert_eq!(value("LN(0)"), Value::Error(Error::Number));
}

#[test]
fn average_is_over_the_numbers_that_are_there() {
    let sheet = column();

    // Three numbers, not five cells: the heading and the gap are not nought.
    assert_eq!(on(&sheet, "AVERAGE(A1:A5)"), Value::Number(20.0));
    assert_eq!(number("AVERAGE(1,2,3,4)"), 2.5);
    assert_eq!(number("AVERAGE(2)"), 2.0);
    assert_eq!(value("AVERAGE(\"a\")"), Value::Error(Error::DivideByZero));

    let empty = Sheet::default();
    assert_eq!(
        on(&empty, "AVERAGE(A1:A5)"),
        Value::Error(Error::DivideByZero)
    );
}

#[test]
fn count_and_counta_are_different_questions() {
    let sheet = column();

    assert_eq!(on(&sheet, "COUNT(A1:A5)"), Value::Number(3.0));
    assert_eq!(on(&sheet, "COUNTA(A1:A5)"), Value::Number(4.0));
    assert_eq!(on(&sheet, "COUNTBLANK(A1:A5)"), Value::Number(1.0));
    assert_eq!(number("COUNT(1,2,3)"), 3.0);
    assert_eq!(number("COUNTA(1,\"a\",TRUE)"), 3.0);
}

#[test]
fn min_and_max_ignore_the_words_among_the_numbers() {
    let sheet = column();

    assert_eq!(on(&sheet, "MIN(A1:A5)"), Value::Number(10.0));
    assert_eq!(on(&sheet, "MAX(A1:A5)"), Value::Number(30.0));
    assert_eq!(number("MIN(3,1,2)"), 1.0);
    assert_eq!(number("MAX(-3,-1)"), -1.0);

    // Nothing to compare is nought, which is Excel's answer and not an error.
    let empty = Sheet::default();
    assert_eq!(on(&empty, "MAX(A1:A5)"), Value::Number(0.0));
}

#[test]
fn median_is_the_middle_one_or_the_two_of_them() {
    assert_eq!(number("MEDIAN(1,2,3)"), 2.0);
    assert_eq!(number("MEDIAN(1,2,3,4)"), 2.5);
    assert_eq!(number("MEDIAN(3,1,2)"), 2.0);
    assert_eq!(number("MEDIAN(5)"), 5.0);

    let sheet = column();
    assert_eq!(on(&sheet, "MEDIAN(A1:A5)"), Value::Number(20.0));
}

#[test]
fn if_does_not_work_out_the_branch_it_does_not_take() {
    // The whole reason `IF` takes its arguments unevaluated: this formula
    // guards against the division, and a spreadsheet that divided anyway
    // would be wrong about the one thing it was written for.
    let sheet = Sheet::with(&[("A1", Value::Number(0.0))]);

    assert_eq!(on(&sheet, "IF(A1=0,0,1/A1)"), Value::Number(0.0));
    assert_eq!(value("IF(TRUE,\"yes\",\"no\")"), Value::Text("yes".into()));
    assert_eq!(value("IF(FALSE,\"yes\",\"no\")"), Value::Text("no".into()));
    assert_eq!(value("IF(FALSE,\"yes\")"), Value::Bool(false));
    assert_eq!(value("IF(1,\"yes\",\"no\")"), Value::Text("yes".into()));
}

#[test]
fn ifs_takes_the_first_that_holds() {
    assert_eq!(value("IFS(FALSE,1,TRUE,2)"), Value::Number(2.0));
    assert_eq!(value("IFS(TRUE,1,TRUE,2)"), Value::Number(1.0));
    assert_eq!(
        value("IFS(FALSE,1,FALSE,2)"),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(value("IFS(1>2,\"a\",2>1,\"b\")"), Value::Text("b".into()));
    assert_eq!(value("IFS(TRUE,\"only\")"), Value::Text("only".into()));
}

#[test]
fn and_or_not_answer_with_the_two_words() {
    assert_eq!(value("AND(TRUE,TRUE)"), Value::Bool(true));
    assert_eq!(value("AND(TRUE,FALSE)"), Value::Bool(false));
    assert_eq!(value("OR(FALSE,TRUE)"), Value::Bool(true));
    assert_eq!(value("OR(FALSE,FALSE)"), Value::Bool(false));
    assert_eq!(value("NOT(TRUE)"), Value::Bool(false));
    assert_eq!(value("XOR(TRUE,TRUE)"), Value::Bool(false));
}

#[test]
fn and_over_a_column_skips_what_is_not_a_question() {
    let sheet = Sheet::with(&[
        ("A1", Value::Text("Header".into())),
        ("A2", Value::Bool(true)),
        ("A3", Value::Bool(true)),
    ]);

    assert_eq!(on(&sheet, "AND(A1:A3)"), Value::Bool(true));
}

#[test]
fn iferror_catches_what_it_is_pointed_at() {
    assert_eq!(value("IFERROR(1/0,\"oops\")"), Value::Text("oops".into()));
    assert_eq!(value("IFERROR(1,\"oops\")"), Value::Number(1.0));
    assert_eq!(value("IFERROR(#N/A,0)"), Value::Number(0.0));

    // `IFNA` catches only the one that means "nothing was found", so a broken
    // formula still says it is broken.
    assert_eq!(value("IFNA(#N/A,0)"), Value::Number(0.0));
    assert_eq!(value("IFNA(1/0,0)"), Value::Error(Error::DivideByZero));
}

#[test]
fn the_words_are_functions_as_well_as_values() {
    assert_eq!(value("TRUE()"), Value::Bool(true));
    assert_eq!(value("FALSE()"), Value::Bool(false));
    assert_eq!(value("NOT(FALSE())"), Value::Bool(true));
    assert_eq!(value("AND(TRUE(),TRUE)"), Value::Bool(true));
    assert_eq!(value("IF(TRUE(),1,2)"), Value::Number(1.0));
}

#[test]
fn len_counts_letters_rather_than_bytes() {
    assert_eq!(number("LEN(\"hello\")"), 5.0);
    assert_eq!(number("LEN(\"\")"), 0.0);
    assert_eq!(number("LEN(\"Київ\")"), 4.0);
    assert_eq!(number("LEN(12345)"), 5.0);
    assert_eq!(number("LEN(\" a \")"), 3.0);
}

#[test]
fn left_right_and_mid_count_from_one() {
    assert_eq!(text("LEFT(\"spreadsheet\",6)"), "spread");
    assert_eq!(text("RIGHT(\"spreadsheet\",5)"), "sheet");
    assert_eq!(text("MID(\"spreadsheet\",7,5)"), "sheet");
    assert_eq!(text("LEFT(\"abc\")"), "a");
    assert_eq!(text("MID(\"abc\",5,2)"), "");
}

#[test]
fn case_and_spacing_are_tidied_the_way_excel_tidies_them() {
    assert_eq!(text("UPPER(\"abc\")"), "ABC");
    assert_eq!(text("LOWER(\"ABC\")"), "abc");
    // `TRIM` squeezes the spaces inside as well as the ones at the ends: it
    // exists for text out of a system that padded its columns.
    assert_eq!(text("TRIM(\"  a   b  \")"), "a b");
    assert_eq!(text("UPPER(\"київ\")"), "КИЇВ");
    assert_eq!(text("TRIM(\"already\")"), "already");
}

#[test]
fn text_is_joined_three_different_ways() {
    assert_eq!(text("CONCAT(\"a\",\"b\",\"c\")"), "abc");
    assert_eq!(text("CONCATENATE(\"a\",1)"), "a1");
    assert_eq!(text("TEXTJOIN(\", \",TRUE,\"a\",\"b\")"), "a, b");
    assert_eq!(text("TEXTJOIN(\"-\",TRUE,1,2,3)"), "1-2-3");

    let sheet = Sheet::with(&[
        ("A1", Value::Text("a".into())),
        ("A3", Value::Text("c".into())),
    ]);
    // The blank in the middle is skipped because the second argument says so.
    assert_eq!(
        on(&sheet, "TEXTJOIN(\",\",TRUE,A1:A3)"),
        Value::Text("a,c".into())
    );
}

#[test]
fn find_minds_the_case_and_search_does_not() {
    assert_eq!(number("FIND(\"b\",\"abc\")"), 2.0);
    assert_eq!(value("FIND(\"B\",\"abc\")"), Value::Error(Error::Value));
    assert_eq!(number("SEARCH(\"B\",\"abc\")"), 2.0);
    assert_eq!(number("FIND(\"a\",\"banana\",3)"), 4.0);
    assert_eq!(number("SEARCH(\"ї\",\"Київ\")"), 3.0);
}

#[test]
fn exact_is_the_one_comparison_that_minds_the_case() {
    assert_eq!(value("EXACT(\"a\",\"a\")"), Value::Bool(true));
    assert_eq!(value("EXACT(\"a\",\"A\")"), Value::Bool(false));
    assert_eq!(value("EXACT(\"\",\"\")"), Value::Bool(true));
    assert_eq!(value("EXACT(1,\"1\")"), Value::Bool(true));
    assert_eq!(value("\"a\"=\"A\""), Value::Bool(true));
}

#[test]
fn substitute_replaces_all_of_them_or_one_of_them() {
    assert_eq!(text("SUBSTITUTE(\"a-b-c\",\"-\",\"+\")"), "a+b+c");
    assert_eq!(text("SUBSTITUTE(\"a-b-c\",\"-\",\"+\",2)"), "a-b+c");
    assert_eq!(text("SUBSTITUTE(\"abc\",\"x\",\"y\")"), "abc");
    assert_eq!(text("SUBSTITUTE(\"aaa\",\"a\",\"\")"), "");
    assert_eq!(text("REPT(\"ab\",3)"), "ababab");
}

#[test]
fn a_function_nobody_here_has_implemented_says_so_rather_than_guessing() {
    // The formula keeps its text and the cell says plainly that this program
    // did not know the word — which is what lets a workbook using something
    // unimplemented be saved without being damaged.
    assert_eq!(value("BESSELJ(1,1)"), Value::Error(Error::Name));
    assert_eq!(value("_xlfn.LAMBDA(1)"), Value::Error(Error::Name));
    // And the prefix comes off the ones that are here: a file full of
    // `_xlfn.XLOOKUP` is a file asking for `XLOOKUP`.
    assert_eq!(value("_xlfn.XLOOKUP(1,{1;2},{10;20})"), Value::Number(10.0));
}

#[test]
fn a_function_given_the_wrong_number_of_arguments_says_so() {
    assert_eq!(value("ROUND(1)"), Value::Error(Error::Value));
    assert_eq!(value("ABS(1,2)"), Value::Error(Error::Value));
    assert_eq!(value("PI(1)"), Value::Error(Error::Value));
}

#[test]
fn a_name_is_matched_whatever_case_it_is_written_in() {
    assert_eq!(number("sum(1,2)"), 3.0);
    assert_eq!(number("Round(2.5,0)"), 3.0);
    assert_eq!(number("_xlfn.SUM(1,2)"), 3.0);
}

#[test]
fn replace_swaps_a_run_of_letters_counted_from_one() {
    assert_eq!(text("REPLACE(\"abcdef\",2,3,\"X\")"), "aXef");
    assert_eq!(text("REPLACE(\"abc\",1,0,\"X\")"), "Xabc");
    assert_eq!(text("REPLACE(\"abc\",1,3,\"\")"), "");
    // A start past the end is an append rather than a mistake.
    assert_eq!(text("REPLACE(\"ab\",9,1,\"c\")"), "abc");
    assert_eq!(text("REPLACE(\"2024\",1,2,\"20\")"), "2024");
}

#[test]
fn proper_begins_a_word_after_anything_that_is_not_a_letter() {
    assert_eq!(text("PROPER(\"HELLO WORLD\")"), "Hello World");
    assert_eq!(text("PROPER(\"mary-jane\")"), "Mary-Jane");
    // Which is Excel's rule, wrong about this name and right about the one
    // above it.
    assert_eq!(text("PROPER(\"o'neill\")"), "O'Neill");
    assert_eq!(text("PROPER(\"a1b\")"), "A1B");
    assert_eq!(text("PROPER(\"київ\")"), "Київ");
}

#[test]
fn clean_takes_out_what_nobody_can_see() {
    // What a mainframe export leaves in a column, and what makes a lookup
    // fail against a value that looks identical.
    assert_eq!(text("CLEAN(CHAR(7)&\"abc\")"), "abc");
    assert_eq!(text("CLEAN(\"a\"&CHAR(10)&\"b\")"), "ab");
    assert_eq!(text("CLEAN(\"abc\")"), "abc");
    assert_eq!(text("CLEAN(\"\")"), "");
    assert_eq!(text("TRIM(\"  a  b  \")"), "a b");
}

#[test]
fn value_reads_a_number_out_of_text_and_a_date_too() {
    assert_eq!(number("VALUE(\"123\")"), 123.0);
    assert_eq!(number("VALUE(\"12%\")"), 0.12);
    // Brackets are how an accountant writes a negative.
    assert_eq!(number("VALUE(\"(5)\")"), -5.0);
    assert_eq!(number("VALUE(\"2024-01-15\")"), 45306.0);
    assert_eq!(number("VALUE(\"12:00\")"), 0.5);
    assert_eq!(number("VALUE(42)"), 42.0);
    assert_eq!(value("VALUE(\"twelve\")"), Value::Error(Error::Value));
}

#[test]
fn char_and_code_are_two_ways_round_the_same_table() {
    assert_eq!(text("CHAR(65)"), "A");
    assert_eq!(number("CODE(\"A\")"), 65.0);
    assert_eq!(number("CODE(\"Abc\")"), 65.0);
    assert_eq!(number("CODE(CHAR(233))"), 233.0);
    assert_eq!(value("CHAR(0)"), Value::Error(Error::Value));
    assert_eq!(value("CHAR(256)"), Value::Error(Error::Value));
    assert_eq!(value("CODE(\"\")"), Value::Error(Error::Value));
}

#[test]
fn the_unicode_pair_mean_the_same_thing_on_every_machine() {
    // Unlike `CHAR`, which means whatever the machine's code page says.
    assert_eq!(text("UNICHAR(65)"), "A");
    assert_eq!(number("UNICODE(\"Ї\")"), 1031.0);
    assert_eq!(number("UNICODE(UNICHAR(9731))"), 9731.0);
    assert_eq!(number("UNICODE(\"€\")"), 8364.0);
    // And in the code page the euro is one byte in the gap 1252 fills.
    assert_eq!(number("CODE(\"€\")"), 128.0);
    assert_eq!(value("UNICHAR(0)"), Value::Error(Error::Value));
}

#[test]
fn textbefore_and_textafter_split_on_a_delimiter_somebody_names() {
    assert_eq!(text("TEXTBEFORE(\"a,b,c\",\",\")"), "a");
    assert_eq!(text("TEXTAFTER(\"a,b,c\",\",\")"), "b,c");
    assert_eq!(text("TEXTBEFORE(\"a,b,c\",\",\",2)"), "a,b");
    // A negative count is from the end, which is how you ask for the last one
    // without counting them first.
    assert_eq!(text("TEXTAFTER(\"a,b,c\",\",\",-1)"), "c");
    // A delimiter that is not there has no answer, and either half would be
    // a guess at which one was wanted.
    assert_eq!(
        value("TEXTBEFORE(\"abc\",\",\")"),
        Value::Error(Error::NotAvailable)
    );
    assert_eq!(
        value("TEXTAFTER(\"abc\",\",\")"),
        Value::Error(Error::NotAvailable)
    );
}
