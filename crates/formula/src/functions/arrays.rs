//! The functions whose answer does not fit in a cell.
//!
//! Every one of these hands back a rectangle, and the engine writes it across
//! the cells below and to the right (`engine.rs`). That is what makes them
//! different from everything else here: a formula that used to answer about
//! one cell can now fill twenty, and a column of unique values is one formula
//! rather than a menu, a dialog and a copy.
//!
//! They are Excel's newer functions, which is why files write them with an
//! `_xlfn.` in front — an older reader that meets `_xlfn.UNIQUE` is being
//! told plainly that it does not have it. The prefix comes off when the name
//! is looked up, so a file written by Excel and a formula typed here are the
//! same formula.

use super::{done, number, string, table, Function};
use crate::eval::evaluate;
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

function!(SEQUENCE, "SEQUENCE", 1, Some(4), |arguments, context| {
    done((|| {
        let rows = number(arguments.first(), context)?.trunc();
        let columns = match arguments.get(1) {
            None => 1.0,
            Some(_) => number(arguments.get(1), context)?.trunc(),
        };
        let from = match arguments.get(2) {
            None => 1.0,
            Some(_) => number(arguments.get(2), context)?,
        };
        let step = match arguments.get(3) {
            None => 1.0,
            Some(_) => number(arguments.get(3), context)?,
        };

        if rows < 1.0 || columns < 1.0 {
            return Ok(Value::Error(Error::Value));
        }

        let rows = rows as usize;
        let columns = columns as usize;
        let mut values = Vec::with_capacity(rows * columns);

        for step_number in 0..rows * columns {
            values.push(Value::Number(from + step * step_number as f64));
        }

        Ok(Value::Array(Array::new(rows, columns, values)))
    })())
});

function!(TRANSPOSE, "TRANSPOSE", 1, Some(1), |arguments, context| {
    done((|| {
        let grid = table(arguments.first(), context)?;
        let mut values = Vec::with_capacity(grid.values.len());

        for column in 0..grid.columns {
            for row in 0..grid.rows {
                values.push(grid.at(row, column).clone());
            }
        }

        Ok(Value::Array(Array::new(grid.columns, grid.rows, values)))
    })())
});

function!(SORT, "SORT", 1, Some(4), |arguments, context| {
    done((|| {
        let grid = table(arguments.first(), context)?;
        let by = match arguments.get(1) {
            None => 1.0,
            Some(_) => number(arguments.get(1), context)?.trunc(),
        };
        let descending = match arguments.get(2) {
            None => false,
            Some(_) => number(arguments.get(2), context)? < 0.0,
        };
        let across = match arguments.get(3) {
            None => false,
            Some(expression) => evaluate(expression, context).to_bool()?,
        };

        // Rows move whole, always. A table sorted a column at a time is a
        // table whose rows have stopped meaning anything, which is the one
        // mistake a sort must never make on somebody's behalf.
        let lines = if across { grid.columns } else { grid.rows };
        let width = if across { grid.rows } else { grid.columns };
        let by = by as usize;

        if by < 1 || by > width {
            return Ok(Value::Error(Error::Value));
        }

        let mut order: Vec<usize> = (0..lines).collect();
        order.sort_by(|left, right| {
            let here = line_item(&grid, across, *left, by - 1);
            let there = line_item(&grid, across, *right, by - 1);

            let found = compare(here, there).unwrap_or(std::cmp::Ordering::Equal);
            if descending {
                found.reverse()
            } else {
                found
            }
        });

        Ok(Value::Array(rearranged(&grid, across, &order)))
    })())
});

function!(SORTBY, "SORTBY", 2, None, |arguments, context| {
    done((|| {
        let grid = table(arguments.first(), context)?;

        // Pairs of "sort by this, in this direction" — and the thing sorted
        // by need not be in the table at all, which is the difference from
        // `SORT` and the reason this one exists.
        let mut keys: Vec<(Array, bool)> = Vec::new();
        let mut at = 1;
        while at < arguments.len() {
            let column = table(arguments.get(at), context)?;
            let descending = match arguments.get(at + 1) {
                None => false,
                Some(_) => number(arguments.get(at + 1), context)? < 0.0,
            };

            if column.values.len() != grid.rows {
                return Ok(Value::Error(Error::Value));
            }

            keys.push((column, descending));
            at += 2;
        }

        let mut order: Vec<usize> = (0..grid.rows).collect();
        order.sort_by(|left, right| {
            for (column, descending) in &keys {
                let here = &column.values[*left];
                let there = &column.values[*right];
                let found = compare(here, there).unwrap_or(std::cmp::Ordering::Equal);

                if found != std::cmp::Ordering::Equal {
                    return if *descending { found.reverse() } else { found };
                }
            }
            std::cmp::Ordering::Equal
        });

        Ok(Value::Array(rearranged(&grid, false, &order)))
    })())
});

function!(FILTER, "FILTER", 2, Some(3), |arguments, context| {
    done((|| {
        let grid = table(arguments.first(), context)?;
        let kept = table(arguments.get(1), context)?;

        // The test is a column as tall as the table or a row as wide, and
        // its shape says which: a column of answers keeps rows, a row of
        // them keeps columns. Anything else is a question about a table of a
        // different size, and there is no answer to give.
        let down = kept.columns == 1 && kept.rows == grid.rows;
        let across = kept.rows == 1 && kept.columns == grid.columns;

        if !down && !across {
            return Ok(Value::Error(Error::Value));
        }

        // A single value fits both descriptions; keeping rows is what it
        // means, because a column of answers is the ordinary shape.
        let across = across && !down;

        let mut order = Vec::new();
        for (index, test) in kept.values.iter().enumerate() {
            match test.to_bool() {
                Ok(true) => order.push(index),
                Ok(false) => {}
                // A test that is not a question — a word, an error — is not
                // a row to keep and not a reason to stop.
                Err(_) => {}
            }
        }

        if order.is_empty() {
            // Nothing matching is not nothing: a formula has to show
            // something, and Excel lets the caller say what.
            return match arguments.get(2) {
                Some(expression) => Ok(evaluate(expression, context)),
                None => Ok(Value::Error(Error::Calc)),
            };
        }

        Ok(Value::Array(rearranged(&grid, across, &order)))
    })())
});

function!(UNIQUE, "UNIQUE", 1, Some(3), |arguments, context| {
    done((|| {
        let grid = table(arguments.first(), context)?;
        let across = match arguments.get(1) {
            None => false,
            Some(expression) => evaluate(expression, context).to_bool()?,
        };
        let once_only = match arguments.get(2) {
            None => false,
            Some(expression) => evaluate(expression, context).to_bool()?,
        };

        let lines = if across { grid.columns } else { grid.rows };
        let width = if across { grid.rows } else { grid.columns };

        let mut order = Vec::new();
        for index in 0..lines {
            let how_many = (0..lines)
                .filter(|other| same_line(&grid, across, index, *other, width))
                .count();

            let first = (0..index).all(|other| !same_line(&grid, across, index, other, width));
            if !first {
                continue;
            }

            // "Exactly once" is a different question from "which ones are
            // there": a list of what happened only once leaves out the thing
            // that happened twice altogether.
            if once_only && how_many > 1 {
                continue;
            }

            order.push(index);
        }

        if order.is_empty() {
            return Ok(Value::Error(Error::Calc));
        }

        Ok(Value::Array(rearranged(&grid, across, &order)))
    })())
});

function!(TEXTSPLIT, "TEXTSPLIT", 2, Some(6), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let across = string(arguments.get(1), context)?;
        let down = match arguments.get(2) {
            None => String::new(),
            Some(_) => string(arguments.get(2), context)?,
        };

        if across.is_empty() && down.is_empty() {
            return Ok(Value::Error(Error::Value));
        }

        let lines: Vec<&str> = if down.is_empty() {
            vec![text.as_str()]
        } else {
            text.split(down.as_str()).collect()
        };

        let mut rows: Vec<Vec<Value>> = Vec::new();
        let mut width = 0;

        for line in lines {
            let pieces: Vec<Value> = if across.is_empty() {
                vec![Value::Text(line.to_string())]
            } else {
                line.split(across.as_str())
                    .map(|piece| Value::Text(piece.to_string()))
                    .collect()
            };

            width = width.max(pieces.len());
            rows.push(pieces);
        }

        // A short line leaves `#N/A` in the cells it does not reach, as a
        // ragged array literal does: the cells are there and there is nothing
        // to put in them.
        let mut values = Vec::with_capacity(rows.len() * width);
        for row in &rows {
            for column in 0..width {
                values.push(
                    row.get(column)
                        .cloned()
                        .unwrap_or(Value::Error(Error::NotAvailable)),
                );
            }
        }

        Ok(Value::Array(Array::new(rows.len(), width, values)))
    })())
});

/// `RANDARRAY`, which is the only one of these that answers differently
/// every time it is asked.
pub static RANDARRAY: Function = Function {
    name: "RANDARRAY",
    min_arguments: 0,
    max_arguments: Some(5),
    volatile: true,
    call: |arguments, context| {
        done((|| {
            let rows = match arguments.first() {
                None => 1.0,
                Some(_) => number(arguments.first(), context)?.trunc(),
            };
            let columns = match arguments.get(1) {
                None => 1.0,
                Some(_) => number(arguments.get(1), context)?.trunc(),
            };
            let least = match arguments.get(2) {
                None => 0.0,
                Some(_) => number(arguments.get(2), context)?,
            };
            let most = match arguments.get(3) {
                None => 1.0,
                Some(_) => number(arguments.get(3), context)?,
            };
            let whole = match arguments.get(4) {
                None => false,
                Some(expression) => evaluate(expression, context).to_bool()?,
            };

            if rows < 1.0 || columns < 1.0 || least > most {
                return Ok(Value::Error(Error::Value));
            }

            let rows = rows as usize;
            let columns = columns as usize;
            let mut values = Vec::with_capacity(rows * columns);

            for _ in 0..rows * columns {
                let chance = context.cells.random();
                values.push(Value::Number(if whole {
                    // Both ends included, as `RANDBETWEEN` has them.
                    (least + (chance * (most - least + 1.0)).floor()).min(most)
                } else {
                    least + chance * (most - least)
                }));
            }

            Ok(Value::Array(Array::new(rows, columns, values)))
        })())
    },
};

/// One value out of a row or a column, whichever is being worked along.
fn line_item(grid: &Array, across: bool, line: usize, at: usize) -> &Value {
    if across {
        grid.at(at, line)
    } else {
        grid.at(line, at)
    }
}

/// Whether two rows — or two columns — hold the same thing all the way.
fn same_line(grid: &Array, across: bool, here: usize, there: usize, width: usize) -> bool {
    (0..width).all(|at| {
        compare(
            line_item(grid, across, here, at),
            line_item(grid, across, there, at),
        ) == Ok(std::cmp::Ordering::Equal)
    })
}

/// The table again with its rows — or its columns — in the given order.
fn rearranged(grid: &Array, across: bool, order: &[usize]) -> Array {
    let width = if across { grid.rows } else { grid.columns };
    let mut values = Vec::with_capacity(order.len() * width);

    if across {
        for row in 0..grid.rows {
            for line in order {
                values.push(grid.at(row, *line).clone());
            }
        }
        return Array::new(grid.rows, order.len(), values);
    }

    for line in order {
        for column in 0..grid.columns {
            values.push(grid.at(*line, column).clone());
        }
    }

    Array::new(order.len(), grid.columns, values)
}
