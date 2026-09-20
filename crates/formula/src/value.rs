//! What a formula works out to, and how one kind becomes another.
//!
//! The coercion rules are the part people never read and always feel. `"5"+1`
//! is 6 because a string that looks like a number is one when arithmetic asks;
//! `TRUE+1` is 2 because a boolean is one or nought to arithmetic but sorts
//! after every number when compared. None of that is obvious, all of it is
//! Excel, and a spreadsheet that guessed differently would disagree with the
//! file it was given on the second row of the first column.
//!
//! Errors are values here rather than failures. They travel through
//! arithmetic, they are caught by `IFERROR`, and they are what a cell holds
//! when it holds one.

use std::fmt;

/// The errors of the language, in the order Excel numbers them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Null,
    DivideByZero,
    Value,
    Reference,
    Name,
    Number,
    NotAvailable,
    Spill,
    Calc,
}

impl Error {
    pub fn text(self) -> &'static str {
        match self {
            Error::Null => "#NULL!",
            Error::DivideByZero => "#DIV/0!",
            Error::Value => "#VALUE!",
            Error::Reference => "#REF!",
            Error::Name => "#NAME?",
            Error::Number => "#NUM!",
            Error::NotAvailable => "#N/A",
            Error::Spill => "#SPILL!",
            Error::Calc => "#CALC!",
        }
    }

    /// The same words back again, for an error written into a formula.
    pub fn from_text(text: &str) -> Option<Self> {
        match text.to_ascii_uppercase().as_str() {
            "#NULL!" => Some(Error::Null),
            "#DIV/0!" => Some(Error::DivideByZero),
            "#VALUE!" => Some(Error::Value),
            "#REF!" => Some(Error::Reference),
            "#NAME?" => Some(Error::Name),
            "#NUM!" => Some(Error::Number),
            "#N/A" => Some(Error::NotAvailable),
            "#SPILL!" => Some(Error::Spill),
            "#CALC!" => Some(Error::Calc),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(self.text())
    }
}

/// A value, as a cell holds one or a formula works one out.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Number(f64),
    Text(String),
    Bool(bool),
    Error(Error),
    /// A cell with nothing in it, which is not the same as one holding "".
    Blank,
    /// Rows of values: an array literal, or what a range comes to.
    Array(Array),
}

/// A rectangle of values, which is what a range or a literal amounts to.
#[derive(Debug, Clone, PartialEq)]
pub struct Array {
    pub rows: usize,
    pub columns: usize,
    /// Row by row, left to right — `rows * columns` of them.
    pub values: Vec<Value>,
}

impl Array {
    pub fn new(rows: usize, columns: usize, values: Vec<Value>) -> Self {
        Self {
            rows,
            columns,
            values,
        }
    }

    pub fn at(&self, row: usize, column: usize) -> &Value {
        self.values
            .get(row * self.columns + column)
            .unwrap_or(&Value::Blank)
    }

    /// The single value an array of one amounts to, which is what a formula
    /// expecting one gets from a range of one cell.
    pub fn only(&self) -> Option<&Value> {
        if self.rows == 1 && self.columns == 1 {
            self.values.first()
        } else {
            None
        }
    }
}

impl Value {
    pub fn error(error: Error) -> Self {
        Value::Error(error)
    }

    /// Whether this is an error, which stops most of what would follow.
    pub fn is_error(&self) -> bool {
        matches!(self, Value::Error(_))
    }

    /// The number a value is to arithmetic, or the error that stops it.
    ///
    /// Blank is nought, a boolean is one or nought, and text is whatever it
    /// parses as — `"5"` is five and `"five"` is `#VALUE!`. That last one is
    /// the rule people meet when a column arrives from a text file.
    pub fn to_number(&self) -> Result<f64, Error> {
        match self {
            Value::Number(value) => Ok(*value),
            Value::Bool(value) => Ok(if *value { 1.0 } else { 0.0 }),
            Value::Blank => Ok(0.0),
            Value::Error(error) => Err(*error),
            Value::Text(text) => parse_number(text).ok_or(Error::Value),
            Value::Array(array) => match array.only() {
                Some(value) => value.to_number(),
                None => Err(Error::Value),
            },
        }
    }

    /// What a value is to `&`, which turns everything into words.
    pub fn to_text(&self) -> Result<String, Error> {
        match self {
            Value::Text(text) => Ok(text.clone()),
            Value::Number(value) => Ok(format_number(*value)),
            // Upper case, as Excel writes them when they are joined to text.
            Value::Bool(value) => Ok(if *value {
                "TRUE".into()
            } else {
                "FALSE".into()
            }),
            Value::Blank => Ok(String::new()),
            Value::Error(error) => Err(*error),
            Value::Array(array) => match array.only() {
                Some(value) => value.to_text(),
                None => Err(Error::Value),
            },
        }
    }

    /// What a value is to `IF`, which is a question rather than a number.
    pub fn to_bool(&self) -> Result<bool, Error> {
        match self {
            Value::Bool(value) => Ok(*value),
            Value::Number(value) => Ok(*value != 0.0),
            Value::Blank => Ok(false),
            Value::Error(error) => Err(*error),
            Value::Text(text) => match text.to_ascii_uppercase().as_str() {
                "TRUE" => Ok(true),
                "FALSE" => Ok(false),
                // Not a number and not a word for one: `"yes"` is not true.
                _ => Err(Error::Value),
            },
            Value::Array(array) => match array.only() {
                Some(value) => value.to_bool(),
                None => Err(Error::Value),
            },
        }
    }

    /// Where a value sits when values of different kinds are compared.
    ///
    /// Numbers before text, text before booleans — which is why `1 < "a"` and
    /// `"a" < TRUE` are both true in Excel and look wrong until you know.
    fn order(&self) -> u8 {
        match self {
            Value::Blank | Value::Number(_) => 0,
            Value::Text(_) => 1,
            Value::Bool(_) => 2,
            Value::Error(_) => 3,
            Value::Array(_) => 4,
        }
    }
}

/// How two values compare, or the error that stops the comparison.
pub fn compare(left: &Value, right: &Value) -> Result<std::cmp::Ordering, Error> {
    use std::cmp::Ordering;

    if let Value::Error(error) = left {
        return Err(*error);
    }
    if let Value::Error(error) = right {
        return Err(*error);
    }

    // A blank compared with text is compared as "", and with a number as
    // nought: it takes the kind of whatever it is up against.
    let (here, there) = match (left, right) {
        (Value::Blank, Value::Text(_)) => (Value::Text(String::new()), right.clone()),
        (Value::Text(_), Value::Blank) => (left.clone(), Value::Text(String::new())),
        (Value::Blank, Value::Bool(_)) => (Value::Bool(false), right.clone()),
        (Value::Bool(_), Value::Blank) => (left.clone(), Value::Bool(false)),
        _ => (left.clone(), right.clone()),
    };

    if here.order() != there.order() {
        return Ok(here.order().cmp(&there.order()));
    }

    match (&here, &there) {
        (Value::Number(a), Value::Number(b)) => Ok(a.partial_cmp(b).unwrap_or(Ordering::Equal)),
        (Value::Blank, Value::Blank) => Ok(Ordering::Equal),
        (Value::Blank, Value::Number(b)) => Ok(0.0_f64.partial_cmp(b).unwrap_or(Ordering::Equal)),
        (Value::Number(a), Value::Blank) => Ok(a.partial_cmp(&0.0).unwrap_or(Ordering::Equal)),
        // Text compares without case, which is why `"a"="A"` is true.
        (Value::Text(a), Value::Text(b)) => Ok(a.to_uppercase().cmp(&b.to_uppercase())),
        (Value::Bool(a), Value::Bool(b)) => Ok(a.cmp(b)),
        _ => Err(Error::Value),
    }
}

/// Text as a number, the way a spreadsheet reads one.
///
/// The forms a cell's text can take and still be arithmetic: a plain number,
/// one with a sign, one in exponent form, one wrapped in brackets the way
/// accountants write a negative, and one with a percent sign on the end.
pub fn parse_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (body, negative) = match trimmed
        .strip_prefix('(')
        .and_then(|rest| rest.strip_suffix(')'))
    {
        Some(inside) => (inside.trim(), true),
        None => (trimmed, false),
    };

    let (body, percent) = match body.strip_suffix('%') {
        Some(rest) => (rest.trim(), true),
        None => (body, false),
    };

    let value: f64 = body.parse().ok()?;
    let value = if percent { value / 100.0 } else { value };

    Some(if negative { -value } else { value })
}

/// A number as a spreadsheet writes it when it has to become text.
///
/// Fifteen significant digits, which is all Excel shows and therefore all it
/// can be asked to agree about, and no exponent until the number is too large
/// or too small to write out.
pub fn format_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    if !value.is_finite() {
        return "#NUM!".to_string();
    }

    let magnitude = value.abs();
    if !(1e-10..1e16).contains(&magnitude) {
        let written = format!("{value:E}");
        return written.replace('E', "E+").replace("E+-", "E-");
    }

    let rounded = round_to_significant(value, 15);
    let mut written = format!("{rounded}");

    if written.contains('.') {
        written = written
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string();
    }

    written
}

/// A number kept to as many significant digits as a spreadsheet keeps.
pub fn round_to_significant(value: f64, digits: i32) -> f64 {
    if value == 0.0 || !value.is_finite() {
        return value;
    }

    let magnitude = value.abs().log10().floor() as i32;
    let factor = 10_f64.powi(digits - 1 - magnitude);

    (value * factor).round() / factor
}
