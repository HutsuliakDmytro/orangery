//! Finding a value somewhere else.
//!
//! `VLOOKUP` is the most used function in spreadsheets and the most
//! misunderstood: its fourth argument decides whether it looks for exactly
//! what it was given or for the largest thing that is not larger, and left out
//! it means the second — which is why a lookup down an unsorted column
//! silently returns the wrong row. The default is Excel's, and the surprise is
//! Excel's; changing it here would be worse, because then the same workbook
//! would say two different things.

use super::{done, number, Function};
use crate::ast::Expr;
use crate::eval::{evaluate, reference_of, Context, Rect};
use crate::value::{compare, Array, Error, Value};

macro_rules! function {
    ($constant:ident, $name:literal, $least:expr, $most:expr, $body:expr) => {
        pub static $constant: Function = Function {
            name: $name,
            min_arguments: $least,
            max_arguments: $most,
            volatile: false,
            call: $body,
        };
    };
}

/// One argument as a rectangle, whatever shape it arrived in.
fn table(argument: Option<&Expr>, context: &Context<'_>) -> Result<Array, Error> {
    match argument.map(|expression| evaluate(expression, context)) {
        Some(Value::Array(array)) => Ok(array),
        Some(Value::Error(error)) => Err(error),
        // A single value is a table of one, which is what makes `MATCH(x, A1)`
        // answer rather than fail.
        Some(value) => Ok(Array::new(1, 1, vec![value])),
        None => Err(Error::Value),
    }
}

function!(VLOOKUP, "VLOOKUP", 3, Some(4), |arguments, context| {
    done((|| {
        let wanted = evaluate(&arguments[0], context);
        if let Value::Error(error) = wanted {
            return Err(error);
        }

        let grid = table(arguments.get(1), context)?;
        let column = number(arguments.get(2), context)? as usize;

        // Left out means "near enough", which is the default that surprises
        // everybody and the one Excel has.
        let exact = match arguments.get(3) {
            None => false,
            Some(expression) => !evaluate(expression, context).to_bool()?,
        };

        if column < 1 || column > grid.columns {
            return Ok(Value::Error(Error::Reference));
        }

        match row_of(&grid, &wanted, exact)? {
            Some(row) => Ok(grid.at(row, column - 1).clone()),
            None => Ok(Value::Error(Error::NotAvailable)),
        }
    })())
});

function!(HLOOKUP, "HLOOKUP", 3, Some(4), |arguments, context| {
    done((|| {
        let wanted = evaluate(&arguments[0], context);
        if let Value::Error(error) = wanted {
            return Err(error);
        }

        let grid = table(arguments.get(1), context)?;
        let row = number(arguments.get(2), context)? as usize;
        let exact = match arguments.get(3) {
            None => false,
            Some(expression) => !evaluate(expression, context).to_bool()?,
        };

        if row < 1 || row > grid.rows {
            return Ok(Value::Error(Error::Reference));
        }

        match column_of(&grid, &wanted, exact)? {
            Some(column) => Ok(grid.at(row - 1, column).clone()),
            None => Ok(Value::Error(Error::NotAvailable)),
        }
    })())
});

function!(INDEX, "INDEX", 2, Some(3), |arguments, context| {
    done((|| {
        let grid = table(arguments.first(), context)?;
        let row = number(arguments.get(1), context)? as usize;
        let column = match arguments.get(2) {
            None => 0,
            Some(_) => number(arguments.get(2), context)? as usize,
        };

        // A nought means "all of them", which is what makes `INDEX(A1:C9,0,2)`
        // a whole column. One row and one column is the ordinary case.
        if row == 0 && column == 0 {
            return Ok(Value::Array(grid));
        }

        if grid.rows == 1 && column == 0 {
            // A single row indexed by one number is indexed across it.
            return Ok(at(&grid, 0, row.saturating_sub(1)));
        }
        if grid.columns == 1 && column == 0 {
            return Ok(at(&grid, row.saturating_sub(1), 0));
        }

        if row == 0 {
            let values: Vec<Value> = (0..grid.rows)
                .map(|index| at(&grid, index, column.saturating_sub(1)))
                .collect();
            return Ok(Value::Array(Array::new(grid.rows, 1, values)));
        }
        if column == 0 {
            let values: Vec<Value> = (0..grid.columns)
                .map(|index| at(&grid, row.saturating_sub(1), index))
                .collect();
            return Ok(Value::Array(Array::new(1, grid.columns, values)));
        }

        Ok(at(&grid, row.saturating_sub(1), column.saturating_sub(1)))
    })())
});

function!(MATCH, "MATCH", 2, Some(3), |arguments, context| {
    done((|| {
        let wanted = evaluate(&arguments[0], context);
        if let Value::Error(error) = wanted {
            return Err(error);
        }

        let grid = table(arguments.get(1), context)?;
        let how = match arguments.get(2) {
            None => 1.0,
            Some(_) => number(arguments.get(2), context)?,
        };

        let values: Vec<&Value> = grid.values.iter().collect();

        // 0 is exact, 1 is the largest that is not larger (needs a sorted
        // list), -1 the smallest that is not smaller.
        let found = match how {
            0.0 => values
                .iter()
                .position(|value| compare(value, &wanted) == Ok(std::cmp::Ordering::Equal)),
            one if one > 0.0 => nearest_below(&values, &wanted),
            _ => nearest_above(&values, &wanted),
        };

        match found {
            Some(index) => Ok(Value::Number((index + 1) as f64)),
            None => Ok(Value::Error(Error::NotAvailable)),
        }
    })())
});

function!(CHOOSE, "CHOOSE", 2, None, |arguments, context| {
    done((|| {
        let which = number(arguments.first(), context)? as usize;

        // Counted from one, and the first argument is the number itself — so
        // a nought would land on the selector and answer with it rather than
        // saying that there is no nought-th choice.
        if which < 1 {
            return Ok(Value::Error(Error::Value));
        }

        match arguments.get(which) {
            Some(expression) => Ok(evaluate(expression, context)),
            None => Ok(Value::Error(Error::Value)),
        }
    })())
});

function!(ROW, "ROW", 0, Some(1), |arguments, context| {
    match arguments.first() {
        // No argument means the cell the formula is in, which is how a
        // numbered column is written.
        None => Value::Number((context.at.0 + 1) as f64),
        Some(expression) => match reference_of(expression, context) {
            Some(rect) => Value::Number((rect.top + 1) as f64),
            None => Value::Error(Error::Value),
        },
    }
});

function!(COLUMN, "COLUMN", 0, Some(1), |arguments, context| {
    match arguments.first() {
        None => Value::Number((context.at.1 + 1) as f64),
        Some(expression) => match reference_of(expression, context) {
            Some(rect) => Value::Number((rect.left + 1) as f64),
            None => Value::Error(Error::Value),
        },
    }
});

function!(ROWS, "ROWS", 1, Some(1), |arguments, context| {
    // A reference is measured rather than read: `ROWS(A:A)` is a question
    // about the sheet, not a reason to fetch a column of it.
    match arguments
        .first()
        .and_then(|first| reference_of(first, context))
    {
        Some(rect) => Value::Number(rect.height() as f64),
        None => done(table(arguments.first(), context).map(|grid| Value::Number(grid.rows as f64))),
    }
});

function!(COLUMNS, "COLUMNS", 1, Some(1), |arguments, context| {
    match arguments
        .first()
        .and_then(|first| reference_of(first, context))
    {
        Some(rect) => Value::Number(rect.width() as f64),
        None => {
            done(table(arguments.first(), context).map(|grid| Value::Number(grid.columns as f64)))
        }
    }
});

/// `OFFSET` and `INDIRECT` are volatile: what they point at is worked out
/// from values rather than written down, so the graph cannot hold an edge to
/// it and the only safe answer is to work them out every time.
pub static OFFSET: Function = Function {
    name: "OFFSET",
    min_arguments: 3,
    max_arguments: Some(5),
    volatile: true,
    call: |arguments, context| match offset(arguments, context) {
        Ok(rect) => rect.value(context),
        Err(error) => Value::Error(error),
    },
};

pub static INDIRECT: Function = Function {
    name: "INDIRECT",
    min_arguments: 1,
    max_arguments: Some(2),
    volatile: true,
    call: |arguments, context| match indirect(arguments, context) {
        Ok(rect) => rect.value(context),
        Err(error) => Value::Error(error),
    },
};

/// The rectangle `OFFSET` moves to, or why it could not.
pub fn offset(arguments: &[Expr], context: &Context<'_>) -> Result<Rect, Error> {
    let Some(from) = arguments
        .first()
        .and_then(|first| reference_of(first, context))
    else {
        // A number is not a place to start from.
        return Err(Error::Value);
    };

    let down = number(arguments.get(1), context)? as i64;
    let across = number(arguments.get(2), context)? as i64;

    // Left out, the new rectangle is the shape of the old one — which is what
    // makes `OFFSET(A1:B3,1,0)` the same block one row down.
    let height = match arguments.get(3) {
        None => from.height(),
        Some(_) => number(arguments.get(3), context)? as i64,
    };
    let width = match arguments.get(4) {
        None => from.width(),
        Some(_) => number(arguments.get(4), context)? as i64,
    };

    // A rectangle of no rows is not a rectangle. Excel's newer readings of a
    // negative size are left out rather than guessed at.
    if height < 1 || width < 1 {
        return Err(Error::Reference);
    }

    let top = from.top + down;
    let left = from.left + across;

    // Off the top or the left of the sheet there is nothing to point at.
    if top < 0 || left < 0 {
        return Err(Error::Reference);
    }

    Ok(Rect {
        sheet: from.sheet,
        top,
        bottom: top + height - 1,
        left,
        right: left + width - 1,
    })
}

/// The rectangle a piece of text names.
pub fn indirect(arguments: &[Expr], context: &Context<'_>) -> Result<Rect, Error> {
    // The second argument asks for R1C1, which this engine does not read yet
    // (`PLAN.md`, after Update 1). Answering in A1 anyway would point at the
    // wrong cell in silence, which is the one thing worse than saying no.
    if let Some(expression) = arguments.get(1) {
        if !evaluate(expression, context).to_bool()? {
            return Err(Error::Reference);
        }
    }

    let text = super::string(arguments.first(), context)?;
    let tree = crate::parser::parse(&text).map_err(|_| Error::Reference)?;

    // Text that parses as something other than a reference — a sum, a word —
    // names no cell, and `#REF!` is what Excel says about it.
    reference_of(&tree, context).ok_or(Error::Reference)
}

function!(SUMIF, "SUMIF", 2, Some(3), |arguments, context| {
    done((|| {
        let over = table(arguments.first(), context)?;
        let test = evaluate(&arguments[1], context);
        let added = match arguments.get(2) {
            None => over.clone(),
            Some(_) => table(arguments.get(2), context)?,
        };

        let mut total = 0.0;
        for (index, value) in over.values.iter().enumerate() {
            if !matches(value, &test)? {
                continue;
            }

            // The second range is lined up with the first by position, which
            // is why a shorter one is a mistake rather than a shorter answer.
            if let Some(Value::Number(number)) = added.values.get(index) {
                total += number;
            }
        }

        Ok(Value::Number(total))
    })())
});

function!(COUNTIF, "COUNTIF", 2, Some(2), |arguments, context| {
    done((|| {
        let over = table(arguments.first(), context)?;
        let test = evaluate(&arguments[1], context);

        let mut how_many = 0usize;
        for value in &over.values {
            if matches(value, &test)? {
                how_many += 1;
            }
        }

        Ok(Value::Number(how_many as f64))
    })())
});

function!(AVERAGEIF, "AVERAGEIF", 2, Some(3), |arguments, context| {
    done((|| {
        let over = table(arguments.first(), context)?;
        let test = evaluate(&arguments[1], context);
        let averaged = match arguments.get(2) {
            None => over.clone(),
            Some(_) => table(arguments.get(2), context)?,
        };

        let mut total = 0.0;
        let mut how_many = 0usize;

        for (index, value) in over.values.iter().enumerate() {
            if !matches(value, &test)? {
                continue;
            }
            if let Some(Value::Number(number)) = averaged.values.get(index) {
                total += number;
                how_many += 1;
            }
        }

        if how_many == 0 {
            return Ok(Value::Error(Error::DivideByZero));
        }

        Ok(Value::Number(total / how_many as f64))
    })())
});

/// What a criterion says, once it has been read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Test {
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
}

/// Whether a value answers a criterion.
///
/// A criterion is a value or a little sentence: `">5"`, `"<>x"`, `"app*"`.
/// The operator is written into the text, which is why this reads a value
/// rather than being handed two numbers — and text criteria take the
/// wildcards, because `COUNTIF(A:A,"north*")` is what people write.
fn matches(value: &Value, criterion: &Value) -> Result<bool, Error> {
    use std::cmp::Ordering;

    let (test, against) = match criterion {
        Value::Text(text) => split_criterion(text),
        other => (Test::Equal, other.clone()),
    };

    // An empty cell answers only the criterion that asks for one. Every other
    // criterion passes it over, which is why `COUNTIF(A:A,"<5")` counts the
    // numbers in the column rather than the million cells that are not there
    // — and why `COUNTIF(A:A,"<>")` is a count of what is filled in.
    if matches!(value, Value::Blank) {
        return Ok(test == Test::Equal && against == Value::Text(String::new()));
    }

    // A pattern is only a pattern for equality: `">a*"` is a comparison
    // against the text `a*`, which is what Excel does with it.
    if let Value::Text(pattern) = &against {
        if matches!(test, Test::Equal | Test::NotEqual) && pattern.contains(['*', '?']) {
            let text = match value {
                Value::Text(text) => text.clone(),
                Value::Blank => String::new(),
                other => other.to_text().unwrap_or_default(),
            };

            let same = glob(pattern, &text);
            return Ok(if test == Test::Equal { same } else { !same });
        }
    }

    // A comparison is between two of a kind: a word in the column is not
    // "greater than 5", and a number is not after "a" — though the kinds do
    // have an order, which is what makes sorting work and would make every
    // word in a column match `">5"` if it were used here. Equality needs no
    // such guard: values of different kinds are simply not equal.
    if !matches!(test, Test::Equal | Test::NotEqual) && !alike(value, &against) {
        return Ok(false);
    }

    let order = match compare(value, &against) {
        Ok(order) => order,
        // A comparison that cannot be made is a row that does not match,
        // rather than a total that fails.
        Err(_) => return Ok(false),
    };

    Ok(match test {
        Test::Equal => order == Ordering::Equal,
        Test::NotEqual => order != Ordering::Equal,
        Test::Less => order == Ordering::Less,
        Test::LessOrEqual => order != Ordering::Greater,
        Test::Greater => order == Ordering::Greater,
        Test::GreaterOrEqual => order != Ordering::Less,
    })
}

/// Whether two values are of a kind that can be put in order against
/// each other.
fn alike(left: &Value, right: &Value) -> bool {
    matches!(
        (left, right),
        (Value::Number(_), Value::Number(_))
            | (Value::Text(_), Value::Text(_))
            | (Value::Bool(_), Value::Bool(_))
    )
}

/// `">5"` into the comparison it means and the value it compares against.
fn split_criterion(text: &str) -> (Test, Value) {
    let trimmed = text.trim();

    let (test, rest) = if let Some(rest) = trimmed.strip_prefix(">=") {
        (Test::GreaterOrEqual, rest)
    } else if let Some(rest) = trimmed.strip_prefix("<=") {
        (Test::LessOrEqual, rest)
    } else if let Some(rest) = trimmed.strip_prefix("<>") {
        (Test::NotEqual, rest)
    } else if let Some(rest) = trimmed.strip_prefix('>') {
        (Test::Greater, rest)
    } else if let Some(rest) = trimmed.strip_prefix('<') {
        (Test::Less, rest)
    } else if let Some(rest) = trimmed.strip_prefix('=') {
        (Test::Equal, rest)
    } else {
        (Test::Equal, trimmed)
    };

    let value = match crate::value::parse_number(rest) {
        Some(number) => Value::Number(number),
        None => Value::Text(rest.to_string()),
    };

    (test, value)
}

/// A pattern where `*` stands for anything and `?` for one letter.
///
/// Walked rather than turned into a regular expression, because the crate
/// carries no dependencies and this is the whole of what the pattern language
/// is. Case is ignored, as everywhere else a spreadsheet compares words.
fn glob(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let text: Vec<char> = text.to_lowercase().chars().collect();

    let mut here = 0usize;
    let mut there = 0usize;
    let mut star: Option<(usize, usize)> = None;

    while there < text.len() {
        match pattern.get(here) {
            Some('*') => {
                star = Some((here, there));
                here += 1;
            }
            Some('?') => {
                here += 1;
                there += 1;
            }
            Some(letter) if *letter == text[there] => {
                here += 1;
                there += 1;
            }
            // Back to the last star and let it swallow one more letter.
            _ => match star {
                Some((at, from)) => {
                    here = at + 1;
                    there = from + 1;
                    star = Some((at, from + 1));
                }
                None => return false,
            },
        }
    }

    while pattern.get(here) == Some(&'*') {
        here += 1;
    }

    here == pattern.len()
}

fn at(grid: &Array, row: usize, column: usize) -> Value {
    if row >= grid.rows || column >= grid.columns {
        return Value::Error(Error::Reference);
    }
    grid.at(row, column).clone()
}

/// The row of a table whose first column holds what was asked for.
fn row_of(grid: &Array, wanted: &Value, exact: bool) -> Result<Option<usize>, Error> {
    use std::cmp::Ordering;

    if exact {
        for row in 0..grid.rows {
            if compare(grid.at(row, 0), wanted) == Ok(Ordering::Equal) {
                return Ok(Some(row));
            }
        }
        return Ok(None);
    }

    // Near enough: the last row that is not larger, which is only right if the
    // column is sorted — and Excel says so too.
    let mut found = None;
    for row in 0..grid.rows {
        match compare(grid.at(row, 0), wanted) {
            Ok(Ordering::Greater) => break,
            Ok(_) => found = Some(row),
            Err(_) => continue,
        }
    }

    Ok(found)
}

fn column_of(grid: &Array, wanted: &Value, exact: bool) -> Result<Option<usize>, Error> {
    use std::cmp::Ordering;

    if exact {
        for column in 0..grid.columns {
            if compare(grid.at(0, column), wanted) == Ok(Ordering::Equal) {
                return Ok(Some(column));
            }
        }
        return Ok(None);
    }

    let mut found = None;
    for column in 0..grid.columns {
        match compare(grid.at(0, column), wanted) {
            Ok(Ordering::Greater) => break,
            Ok(_) => found = Some(column),
            Err(_) => continue,
        }
    }

    Ok(found)
}

fn nearest_below(values: &[&Value], wanted: &Value) -> Option<usize> {
    use std::cmp::Ordering;

    let mut found = None;
    for (index, value) in values.iter().enumerate() {
        match compare(value, wanted) {
            Ok(Ordering::Greater) => break,
            Ok(_) => found = Some(index),
            Err(_) => continue,
        }
    }

    found
}

fn nearest_above(values: &[&Value], wanted: &Value) -> Option<usize> {
    use std::cmp::Ordering;

    let mut found = None;
    for (index, value) in values.iter().enumerate() {
        match compare(value, wanted) {
            Ok(Ordering::Less) => break,
            Ok(_) => found = Some(index),
            Err(_) => continue,
        }
    }

    found
}
