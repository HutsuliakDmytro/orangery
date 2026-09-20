//! Finding a value somewhere else.
//!
//! `VLOOKUP` is the most used function in spreadsheets and the most
//! misunderstood: its fourth argument decides whether it looks for exactly
//! what it was given or for the largest thing that is not larger, and left out
//! it means the second — which is why a lookup down an unsorted column
//! silently returns the wrong row. The default is Excel's, and the surprise is
//! Excel's; changing it here would be worse, because then the same workbook
//! would say two different things.

use super::criteria::matches;
use super::{done, number, table, Function};
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
