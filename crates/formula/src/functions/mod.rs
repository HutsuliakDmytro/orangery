//! The functions, and the shelf they stand on.
//!
//! A function is a name, how many arguments it will take, whether it has to be
//! worked out afresh every time, and what it does. Adding one is adding a line
//! to a category's list and a function beside it — which matters, because
//! Excel has five hundred and this will be a long shelf.
//!
//! Arguments arrive unevaluated. Most functions want their values and say so
//! by asking for them, but `IF` must not work out the branch it is not taking
//! — a spreadsheet where `IF(A1=0,0,1/A1)` divides by nought anyway is a
//! spreadsheet that is wrong about the one thing the formula was guarding.

pub mod criteria;
pub mod datetime;
pub mod financial;
pub mod info;
pub mod logical;
pub mod lookup;
pub mod math;
pub mod stats;
pub mod text;

use crate::ast::Expr;
use crate::eval::{evaluate, Context, Rect};
use crate::value::{Array, Error, Value};

/// What a function is, as far as the evaluator is concerned.
pub struct Function {
    pub name: &'static str,
    pub min_arguments: usize,
    /// `None` for the ones that take as many as they are given, like `SUM`.
    pub max_arguments: Option<usize>,
    /// Worked out again on every recalculation, like `NOW` and `RAND`.
    pub volatile: bool,
    pub call: fn(&[Expr], &Context<'_>) -> Value,
}

/// The function of that name, whatever case it was written in.
///
/// `_xlfn.` comes off first: Excel writes it in front of functions that older
/// readers do not have, and a file full of `_xlfn.XLOOKUP` is a file asking
/// for `XLOOKUP`.
pub fn lookup(name: &str) -> Option<&'static Function> {
    let plain = name
        .trim_start_matches("_xlfn.")
        .trim_start_matches("_xlws.")
        .to_ascii_uppercase();

    FUNCTIONS
        .iter()
        .copied()
        .find(|function| function.name == plain)
}

/// Calls a function, or says why it could not.
pub fn call(name: &str, arguments: &[Expr], context: &Context<'_>) -> Value {
    let Some(function) = lookup(name) else {
        // Not implemented and not invented: the formula keeps its text and the
        // cell says plainly that this program did not know the word.
        return Value::Error(Error::Name);
    };

    if arguments.len() < function.min_arguments {
        return Value::Error(Error::Value);
    }
    if let Some(most) = function.max_arguments {
        if arguments.len() > most {
            return Value::Error(Error::Value);
        }
    }

    (function.call)(arguments, context)
}

/// The rectangle a function names, for the few that answer with a place
/// rather than with a value.
///
/// Kept as a second entry point rather than a field on `Function`, because
/// two functions out of five hundred work this way and a field would ask the
/// other four hundred and ninety-eight to say that they do not.
pub fn reference(name: &str, arguments: &[Expr], context: &Context<'_>) -> Option<Rect> {
    match lookup(name)?.name {
        "OFFSET" => lookup::offset(arguments, context).ok(),
        "INDIRECT" => lookup::indirect(arguments, context).ok(),
        _ => None,
    }
}

/// Every function this engine has, in one list for looking up.
static FUNCTIONS: &[&Function] = &[
    &math::SUM,
    &math::PRODUCT,
    &math::ABS,
    &math::ROUND,
    &math::ROUNDUP,
    &math::ROUNDDOWN,
    &math::INT,
    &math::TRUNC,
    &math::MOD,
    &math::SQRT,
    &math::POWER,
    &math::EXP,
    &math::LN,
    &math::LOG,
    &math::LOG10,
    &math::SIGN,
    &math::PI,
    &math::CEILING,
    &math::FLOOR,
    &math::SUMSQ,
    &math::SUMPRODUCT,
    &math::SUMIFS,
    &math::RAND,
    &math::RANDBETWEEN,
    &stats::AVERAGE,
    &stats::COUNT,
    &stats::COUNTA,
    &stats::COUNTBLANK,
    &stats::MIN,
    &stats::MAX,
    &stats::MEDIAN,
    &stats::COUNTIFS,
    &stats::AVERAGEIFS,
    &stats::MODE,
    &stats::MODE_SNGL,
    &stats::VAR,
    &stats::VAR_S,
    &stats::VARP,
    &stats::VAR_P,
    &stats::STDEV,
    &stats::STDEV_S,
    &stats::STDEVP,
    &stats::STDEV_P,
    &stats::RANK,
    &stats::RANK_EQ,
    &stats::RANK_AVG,
    &stats::LARGE,
    &stats::SMALL,
    &stats::PERCENTILE,
    &stats::PERCENTILE_INC,
    &stats::PERCENTILE_EXC,
    &stats::QUARTILE,
    &stats::QUARTILE_INC,
    &stats::QUARTILE_EXC,
    &stats::CORREL,
    &stats::FORECAST,
    &stats::FORECAST_LINEAR,
    &lookup::VLOOKUP,
    &lookup::XLOOKUP,
    &lookup::XMATCH,
    &lookup::LOOKUP,
    &lookup::ADDRESS,
    &lookup::HLOOKUP,
    &lookup::INDEX,
    &lookup::MATCH,
    &lookup::CHOOSE,
    &lookup::OFFSET,
    &lookup::INDIRECT,
    &lookup::ROW,
    &lookup::COLUMN,
    &lookup::ROWS,
    &lookup::COLUMNS,
    &lookup::SUMIF,
    &lookup::COUNTIF,
    &lookup::AVERAGEIF,
    &logical::IF,
    &logical::IFS,
    &logical::AND,
    &logical::OR,
    &logical::NOT,
    &logical::XOR,
    &logical::IFERROR,
    &logical::IFNA,
    &logical::TRUE,
    &logical::FALSE,
    &text::LEN,
    &text::LEFT,
    &text::RIGHT,
    &text::MID,
    &text::UPPER,
    &text::LOWER,
    &text::TRIM,
    &text::CONCAT,
    &text::CONCATENATE,
    &text::TEXTJOIN,
    &text::EXACT,
    &text::FIND,
    &text::SEARCH,
    &text::SUBSTITUTE,
    &text::REPT,
    &text::REPLACE,
    &text::PROPER,
    &text::CLEAN,
    &text::VALUE,
    &text::CHAR,
    &text::CODE,
    &text::UNICHAR,
    &text::UNICODE,
    &text::TEXTBEFORE,
    &text::TEXTAFTER,
    &datetime::TODAY,
    &datetime::NOW,
    &datetime::DATE,
    &datetime::TIME,
    &datetime::YEAR,
    &datetime::MONTH,
    &datetime::DAY,
    &datetime::HOUR,
    &datetime::MINUTE,
    &datetime::SECOND,
    &datetime::WEEKDAY,
    &datetime::WEEKNUM,
    &datetime::ISOWEEKNUM,
    &datetime::EDATE,
    &datetime::EOMONTH,
    &datetime::DAYS,
    &datetime::DATEDIF,
    &datetime::NETWORKDAYS,
    &datetime::NETWORKDAYS_INTL,
    &datetime::WORKDAY,
    &datetime::WORKDAY_INTL,
    &datetime::DATEVALUE,
    &datetime::TIMEVALUE,
    &financial::PMT,
    &financial::FV,
    &financial::PV,
    &financial::NPER,
    &financial::RATE,
    &financial::IPMT,
    &financial::PPMT,
    &financial::NPV,
    &financial::IRR,
    &financial::XNPV,
    &financial::XIRR,
    &financial::SLN,
    &financial::DB,
    &info::ISBLANK,
    &info::ISNUMBER,
    &info::ISTEXT,
    &info::ISLOGICAL,
    &info::ISERROR,
    &info::ISERR,
    &info::ISNA,
    &info::NA,
    &info::N,
    &info::T,
    &info::TYPE,
];

/// One argument as a rectangle, whatever shape it arrived in.
pub fn table(argument: Option<&Expr>, context: &Context<'_>) -> Result<Array, Error> {
    match argument.map(|expression| evaluate(expression, context)) {
        Some(Value::Array(array)) => Ok(array),
        Some(Value::Error(error)) => Err(error),
        // A single value is a table of one, which is what makes `MATCH(x, A1)`
        // answer rather than fail.
        Some(value) => Ok(Array::new(1, 1, vec![value])),
        None => Err(Error::Value),
    }
}

/// Every argument, worked out.
pub fn values(arguments: &[Expr], context: &Context<'_>) -> Vec<Value> {
    arguments
        .iter()
        .map(|argument| evaluate(argument, context))
        .collect()
}

/// One argument as a number, with the error that stops it.
pub fn number(argument: Option<&Expr>, context: &Context<'_>) -> Result<f64, Error> {
    match argument {
        None => Ok(0.0),
        Some(expression) => evaluate(expression, context).to_number(),
    }
}

/// One argument as text.
pub fn string(argument: Option<&Expr>, context: &Context<'_>) -> Result<String, Error> {
    match argument {
        None => Ok(String::new()),
        Some(expression) => evaluate(expression, context).to_text(),
    }
}

/// Every value a list of arguments reaches, ranges opened out.
///
/// What `SUM(A1:A9, B1, 3)` is really given: nine cells, a cell and a number,
/// as one list. What is done with the text and the blanks among them differs
/// from function to function, which is why this hands back values rather than
/// numbers.
pub fn flattened(arguments: &[Expr], context: &Context<'_>) -> Vec<Value> {
    let mut found = Vec::new();

    for argument in arguments {
        match evaluate(argument, context) {
            Value::Array(array) => found.extend(array.values),
            value => found.push(value),
        }
    }

    found
}

/// The numbers among a list of values, as the counting functions want them.
///
/// Text and blanks are left out — `SUM(A1:A9)` over a column with a heading
/// adds the numbers and ignores the word — but a number *typed into the
/// formula* counts even as text, which is Excel's rule and the one nobody
/// guesses: `SUM("5")` is 5 and `SUM(A1)` where A1 holds "5" is nought.
pub fn numbers(values: &[Value], literal_text_counts: bool) -> Result<Vec<f64>, Error> {
    let mut found = Vec::new();

    for value in values {
        match value {
            Value::Number(number) => found.push(*number),
            Value::Bool(flag) => {
                if literal_text_counts {
                    found.push(if *flag { 1.0 } else { 0.0 });
                }
            }
            Value::Text(text) => {
                if literal_text_counts {
                    match crate::value::parse_number(text) {
                        Some(number) => found.push(number),
                        None => return Err(Error::Value),
                    }
                }
            }
            Value::Error(error) => return Err(*error),
            Value::Blank => {}
            Value::Array(array) => {
                let inner = numbers(&array.values, false)?;
                found.extend(inner);
            }
        }
    }

    Ok(found)
}

/// The shape every function's body takes: a value, or the error that stopped it.
pub fn done(result: Result<Value, Error>) -> Value {
    match result {
        Ok(value) => value,
        Err(error) => Value::Error(error),
    }
}
