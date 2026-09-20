//! Finding a value somewhere else.
//!
//! `VLOOKUP` is the most used function in spreadsheets and the most
//! misunderstood: its fourth argument decides whether it looks for exactly
//! what it was given or for the largest thing that is not larger, and left out
//! it means the second — which is why a lookup down an unsorted column
//! silently returns the wrong row. The default is Excel's, and the surprise is
//! Excel's; changing it here would be worse, because then the same workbook
//! would say two different things.

use super::criteria::{glob, matches};
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

function!(XLOOKUP, "XLOOKUP", 3, Some(6), |arguments, context| {
    done((|| {
        let wanted = evaluate(&arguments[0], context);
        if let Value::Error(error) = wanted {
            return Err(error);
        }

        let over = table(arguments.get(1), context)?;
        let giving = table(arguments.get(2), context)?;
        let how = match arguments.get(4) {
            None => 0.0,
            Some(_) => number(arguments.get(4), context)?,
        };
        let backwards = match arguments.get(5) {
            None => false,
            Some(_) => number(arguments.get(5), context)? < 0.0,
        };

        let found = place_of(
            &over.values.iter().collect::<Vec<_>>(),
            &wanted,
            how,
            backwards,
        );

        let Some(index) = found else {
            // The fourth argument is the whole reason people moved to this
            // one: "not found" is a thing you can say something about rather
            // than an error to be wrapped in `IFERROR`, which would also
            // swallow the mistakes you did want to hear about.
            return match arguments.get(3) {
                Some(expression) => Ok(evaluate(expression, context)),
                None => Ok(Value::Error(Error::NotAvailable)),
            };
        };

        answer_at(&giving, &over, index)
    })())
});

function!(XMATCH, "XMATCH", 2, Some(4), |arguments, context| {
    done((|| {
        let wanted = evaluate(&arguments[0], context);
        if let Value::Error(error) = wanted {
            return Err(error);
        }

        let over = table(arguments.get(1), context)?;
        let how = match arguments.get(2) {
            None => 0.0,
            Some(_) => number(arguments.get(2), context)?,
        };
        let backwards = match arguments.get(3) {
            None => false,
            Some(_) => number(arguments.get(3), context)? < 0.0,
        };

        // Exact by default, which is the other half of why these two replaced
        // `MATCH` and `VLOOKUP`: the default is the safe one.
        match place_of(
            &over.values.iter().collect::<Vec<_>>(),
            &wanted,
            how,
            backwards,
        ) {
            Some(index) => Ok(Value::Number((index + 1) as f64)),
            None => Ok(Value::Error(Error::NotAvailable)),
        }
    })())
});

function!(LOOKUP, "LOOKUP", 2, Some(3), |arguments, context| {
    done((|| {
        let wanted = evaluate(&arguments[0], context);
        if let Value::Error(error) = wanted {
            return Err(error);
        }

        let over = table(arguments.get(1), context)?;

        // The older shape of the same idea, and always approximate: it was
        // written when a sorted column was the only kind anybody had.
        let (searched, giving) = match arguments.get(2) {
            Some(_) => (over.clone(), table(arguments.get(2), context)?),
            // The array form searches the first row or column and answers
            // from the last, which is a rule nobody remembers and every old
            // sheet relies on.
            None => {
                if over.columns > over.rows {
                    (row_of_array(&over, 0), row_of_array(&over, over.rows - 1))
                } else {
                    (
                        column_of_array(&over, 0),
                        column_of_array(&over, over.columns - 1),
                    )
                }
            }
        };

        let found = nearest_below(&searched.values.iter().collect::<Vec<_>>(), &wanted);
        match found.and_then(|index| giving.values.get(index)) {
            Some(value) => Ok(value.clone()),
            None => Ok(Value::Error(Error::NotAvailable)),
        }
    })())
});

function!(ADDRESS, "ADDRESS", 2, Some(5), |arguments, context| {
    done((|| {
        let row = number(arguments.first(), context)?.trunc() as i64;
        let column = number(arguments.get(1), context)?.trunc() as i64;
        let pinning = match arguments.get(2) {
            None => 1.0,
            Some(_) => number(arguments.get(2), context)?.trunc(),
        };
        let a1 = match arguments.get(3) {
            None => true,
            Some(expression) => evaluate(expression, context).to_bool()?,
        };

        if row < 1 || column < 1 || !(1.0..=4.0).contains(&pinning) {
            return Ok(Value::Error(Error::Value));
        }

        let pinned_row = matches!(pinning as i64, 1 | 2);
        let pinned_column = matches!(pinning as i64, 1 | 3);

        let address = if a1 {
            format!(
                "{}{}{}{}",
                if pinned_column { "$" } else { "" },
                column_name(column),
                if pinned_row { "$" } else { "" },
                row
            )
        } else {
            // R1C1, which this engine does not read back but can certainly
            // write: `ADDRESS` makes text, and text is all anybody does with
            // it — usually to hand it to `INDIRECT`.
            format!(
                "R{}C{}",
                if pinned_row {
                    row.to_string()
                } else {
                    format!("[{row}]")
                },
                if pinned_column {
                    column.to_string()
                } else {
                    format!("[{column}]")
                }
            )
        };

        match arguments.get(4) {
            None => Ok(Value::Text(address)),
            Some(expression) => {
                let sheet = evaluate(expression, context).to_text()?;
                // A name with a space in it has to be quoted, or the address
                // it makes is one nothing can read back.
                let quoted = if sheet.contains([' ', '\'']) {
                    format!("'{}'", sheet.replace('\'', "''"))
                } else {
                    sheet
                };
                Ok(Value::Text(format!("{quoted}!{address}")))
            }
        }
    })())
});

/// A column's letters, counting from one: 1 is A, 27 is AA.
fn column_name(column: i64) -> String {
    let mut letters = Vec::new();
    let mut left = column;

    // Not quite base twenty-six: there is no zero digit, so each step takes
    // one away before dividing — which is why AA follows Z rather than BA.
    while left > 0 {
        let digit = (left - 1) % 26;
        letters.push((b'A' + digit as u8) as char);
        left = (left - 1) / 26;
    }

    letters.iter().rev().collect()
}

/// Where a value sits in a list, under whichever rule was asked for.
///
/// 0 is exact, -1 the largest that is not larger, 1 the smallest that is not
/// smaller, 2 a pattern. Backwards is from the end, which is how somebody
/// asks for the last of several matches.
fn place_of(values: &[&Value], wanted: &Value, how: f64, backwards: bool) -> Option<usize> {
    use std::cmp::Ordering;

    let exact = |value: &&Value| compare(value, wanted) == Ok(Ordering::Equal);

    let found = match how {
        0.0 => {
            if backwards {
                values.iter().rposition(exact)
            } else {
                values.iter().position(exact)
            }
        }
        2.0 => {
            let pattern = match wanted {
                Value::Text(text) => text.clone(),
                other => other.to_text().unwrap_or_default(),
            };
            let same = |value: &&Value| {
                glob(
                    &pattern,
                    &match value {
                        Value::Text(text) => text.clone(),
                        Value::Blank => String::new(),
                        other => other.to_text().unwrap_or_default(),
                    },
                )
            };
            if backwards {
                values.iter().rposition(same)
            } else {
                values.iter().position(same)
            }
        }
        // The near-enough rules here are not `MATCH`'s. `MATCH` walks a
        // sorted list and stops; these look at every value and keep the
        // closest one on the asked-for side, which is what lets `XLOOKUP`
        // answer about a column nobody sorted — the difference the newer
        // function was added to make.
        less if less < 0.0 => closest(values, wanted, false, backwards),
        _ => closest(values, wanted, true, backwards),
    };

    found
}

/// The nearest value on one side of what was asked for, wherever it sits.
fn closest(values: &[&Value], wanted: &Value, above: bool, backwards: bool) -> Option<usize> {
    use std::cmp::Ordering;

    let order: Vec<usize> = if backwards {
        (0..values.len()).rev().collect()
    } else {
        (0..values.len()).collect()
    };

    let mut best: Option<(usize, &Value)> = None;

    for index in order {
        let value = values[index];
        let Ok(against) = compare(value, wanted) else {
            continue;
        };

        // An exact match is the closest there is, and falls out of this
        // without being a case of its own.
        let on_this_side = if above {
            against != Ordering::Less
        } else {
            against != Ordering::Greater
        };
        if !on_this_side {
            continue;
        }

        let better = match best {
            None => true,
            Some((_, so_far)) => {
                let nearer = compare(value, so_far);
                if above {
                    nearer == Ok(Ordering::Less)
                } else {
                    nearer == Ok(Ordering::Greater)
                }
            }
        };

        if better {
            best = Some((index, value));
        }
    }

    best.map(|(index, _)| index)
}

/// What `XLOOKUP` hands back once it knows which one matched.
///
/// The return range is lined up against the one searched: a column for a
/// column, a row for a row. Where it is wider than the list, the whole row of
/// it comes back — which is the shape a spill will take when there is one.
fn answer_at(giving: &Array, over: &Array, index: usize) -> Result<Value, Error> {
    let down = over.columns == 1 || over.rows > 1;

    if down {
        if index >= giving.rows {
            return Ok(Value::Error(Error::Value));
        }
        if giving.columns == 1 {
            return Ok(giving.at(index, 0).clone());
        }
        return Ok(Value::Array(row_of_array(giving, index)));
    }

    if index >= giving.columns {
        return Ok(Value::Error(Error::Value));
    }
    if giving.rows == 1 {
        return Ok(giving.at(0, index).clone());
    }
    Ok(Value::Array(column_of_array(giving, index)))
}

fn row_of_array(grid: &Array, row: usize) -> Array {
    let values = (0..grid.columns)
        .map(|at| grid.at(row, at).clone())
        .collect();
    Array::new(1, grid.columns, values)
}

fn column_of_array(grid: &Array, column: usize) -> Array {
    let values = (0..grid.rows)
        .map(|at| grid.at(at, column).clone())
        .collect();
    Array::new(grid.rows, 1, values)
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
