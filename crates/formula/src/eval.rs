//! A tree into a value.
//!
//! The evaluator is given the tree and something that can answer "what is in
//! that cell". It does not know where the cells came from, whether they were
//! read from a file, or what will be done with the answer — which is what lets
//! it be tested with a handful of cells in a map and run against a million of
//! them without changing.
//!
//! The rules it implements are Excel's, and the places where they are
//! surprising are the places worth reading: an error travels rather than
//! stopping, a blank is nought to arithmetic and "" to text, and a comparison
//! between two kinds of value has an order that puts every number before every
//! word.

use crate::ast::{Expr, Operator};
use crate::date::DateSystem;
use crate::reference::{Reference, ReferenceKind};
use crate::value::{compare, round_to_significant, Array, Error, Value};

/// Where the values come from.
///
/// One method, because that is all evaluation needs: everything else — how
/// wide a sheet is, where its cells are stored, whether they are loaded — is
/// the caller's business.
pub trait Cells {
    /// What is in a cell of a sheet. `None` for the sheet the formula is on.
    fn value_at(&self, sheet: Option<&str>, row: i64, column: i64) -> Value;

    /// How far a sheet reaches, for `A:A` and the rest.
    ///
    /// A whole column is not a million cells: it is the cells that are there,
    /// and asking the caller is the only way to know which those are.
    fn extent(&self, sheet: Option<&str>) -> (i64, i64) {
        let _ = sheet;
        (0, 0)
    }

    /// What a cell is to the functions that leave some cells out.
    ///
    /// `SUBTOTAL` over a filtered table must not count the rows the filter
    /// hid, and a grand total made of subtotals must not add them twice.
    /// Neither is a question about a cell's value, so neither can be answered
    /// from the value — only whoever holds the sheet knows.
    fn standing(&self, sheet: Option<&str>, row: i64, column: i64) -> Standing {
        let _ = (sheet, row, column);
        Standing::default()
    }

    /// What time it is, as a serial number in this workbook's date system.
    ///
    /// A pure library has no clock, so `NOW()` is worth exactly what the
    /// caller says it is. That is not a compromise: it is what lets a
    /// volatile function be asked twice in a test and answer the same way
    /// both times, and what stops the engine from needing a platform.
    fn now(&self) -> f64 {
        0.0
    }

    /// A number from nought up to but not including one.
    ///
    /// The same seam as the clock, for the same reason: a library that made
    /// its own randomness could not be asked twice and given the same answer,
    /// and a spreadsheet's randomness belongs to the workbook that is being
    /// recalculated rather than to the arithmetic.
    fn random(&self) -> f64 {
        0.0
    }

    /// Which morning this workbook counts its days from.
    ///
    /// Almost every file says 1900; the ones Excel for Mac wrote before 2011
    /// say 1904, and the difference is four years and a day in every date on
    /// the sheet.
    fn date_system(&self) -> DateSystem {
        DateSystem::Excel1900
    }
}

/// What a cell is to a total that leaves some cells out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Standing {
    /// Out of sight because a filter is on. Every kind of `SUBTOTAL` leaves
    /// these out — which is the whole reason the function exists rather than
    /// `SUM` being used over a filtered table.
    pub filtered: bool,
    /// Out of sight because somebody hid the row by hand. Only the hundreds —
    /// 101 to 111 — leave these out, because hiding a row and filtering a
    /// table are different acts and Excel lets a formula tell them apart.
    pub hidden: bool,
    /// Holds a total of its own. No total counts another one, or a column
    /// with subtotals down it and a grand total at the bottom would count
    /// every figure twice.
    pub a_total: bool,
}

/// A rectangle of the sheet, named rather than read.
///
/// What `OFFSET` and `INDIRECT` work out, and what `ROW`, `COLUMN`, `ROWS`
/// and `COLUMNS` ask about: the place, not what is in it. A formula that
/// wants the values never meets one of these — `evaluate` reads them on the
/// way past — which is why this is a second way of asking rather than another
/// kind of `Value`. Making it one would mean every coercion, every
/// comparison and every function had to have an opinion about a rectangle
/// nobody has looked in yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rect {
    /// `None` for the sheet the formula is on.
    pub sheet: Option<String>,
    pub top: i64,
    pub bottom: i64,
    pub left: i64,
    pub right: i64,
}

impl Rect {
    /// The rectangle one cell makes.
    pub fn cell(sheet: Option<String>, row: i64, column: i64) -> Self {
        Self {
            sheet,
            top: row,
            bottom: row,
            left: column,
            right: column,
        }
    }

    pub fn height(&self) -> i64 {
        self.bottom - self.top + 1
    }

    pub fn width(&self) -> i64 {
        self.right - self.left + 1
    }

    /// What is in it: one value for one cell, an array for the rest.
    pub fn value(&self, context: &Context<'_>) -> Value {
        rectangle(
            context,
            self.sheet.as_deref(),
            self.top,
            self.bottom,
            self.left,
            self.right,
        )
    }
}

/// What a formula is being worked out in aid of.
pub struct Context<'a> {
    pub cells: &'a dyn Cells,
    /// Where the formula is, which is what a relative reference is relative to.
    pub at: (i64, i64),
}

/// The value of a formula, with every error it met on the way included.
pub fn evaluate(expression: &Expr, context: &Context<'_>) -> Value {
    match expression {
        Expr::Number(value) => Value::Number(*value),
        Expr::Text(text) => Value::Text(text.clone()),
        Expr::Bool(value) => Value::Bool(*value),
        Expr::Blank => Value::Blank,

        Expr::Error(text) => match Error::from_text(text) {
            Some(error) => Value::Error(error),
            None => Value::Error(Error::Value),
        },

        Expr::Parenthesised(inside) => evaluate(inside, context),

        Expr::Reference(reference) => resolve(reference, context),

        // A name nothing has defined is `#NAME?`: the formula is kept, and
        // the answer says plainly that this program did not know the word.
        Expr::Name(_) => Value::Error(Error::Name),

        Expr::Call { name, arguments } => crate::functions::call(name, arguments, context),

        Expr::Unary { negative, operand } => {
            let value = evaluate(operand, context);
            match value.to_number() {
                Ok(number) => Value::Number(if *negative { -number } else { number }),
                Err(error) => Value::Error(error),
            }
        }

        Expr::Percent(operand) => {
            let value = evaluate(operand, context);
            match value.to_number() {
                Ok(number) => Value::Number(number / 100.0),
                Err(error) => Value::Error(error),
            }
        }

        Expr::Array(rows) => {
            let columns = rows.first().map_or(0, Vec::len);
            let mut values = Vec::new();

            for row in rows {
                // A ragged literal is filled with `#N/A`, which is what Excel
                // puts in the cells a short row does not reach.
                for column in 0..columns {
                    values.push(match row.get(column) {
                        Some(value) => evaluate(value, context),
                        None => Value::Error(Error::NotAvailable),
                    });
                }
            }

            Value::Array(Array::new(rows.len(), columns, values))
        }

        Expr::Binary {
            operator,
            left,
            right,
        } => binary(*operator, left, right, context),
    }
}

fn binary(operator: Operator, left: &Expr, right: &Expr, context: &Context<'_>) -> Value {
    // The reference operators work on references rather than on values, so
    // they are handled before anything is worked out.
    if matches!(
        operator,
        Operator::Range | Operator::Intersect | Operator::Union
    ) {
        return reference_operator(operator, left, right, context);
    }

    let here = evaluate(left, context);
    let there = evaluate(right, context);

    match operator {
        Operator::Concat => match (here.to_text(), there.to_text()) {
            (Ok(a), Ok(b)) => Value::Text(format!("{a}{b}")),
            (Err(error), _) | (_, Err(error)) => Value::Error(error),
        },

        Operator::Equal
        | Operator::NotEqual
        | Operator::Less
        | Operator::LessOrEqual
        | Operator::Greater
        | Operator::GreaterOrEqual => match compare(&here, &there) {
            Err(error) => Value::Error(error),
            Ok(order) => {
                use std::cmp::Ordering;
                Value::Bool(match operator {
                    Operator::Equal => order == Ordering::Equal,
                    Operator::NotEqual => order != Ordering::Equal,
                    Operator::Less => order == Ordering::Less,
                    Operator::LessOrEqual => order != Ordering::Greater,
                    Operator::Greater => order == Ordering::Greater,
                    _ => order != Ordering::Less,
                })
            }
        },

        _ => arithmetic(operator, &here, &there),
    }
}

fn arithmetic(operator: Operator, left: &Value, right: &Value) -> Value {
    let here = match left.to_number() {
        Ok(number) => number,
        Err(error) => return Value::Error(error),
    };
    let there = match right.to_number() {
        Ok(number) => number,
        Err(error) => return Value::Error(error),
    };

    let value = match operator {
        Operator::Add => here + there,
        Operator::Subtract => subtract(here, there),
        Operator::Multiply => here * there,
        Operator::Divide => {
            // Excel's own answer, and the reason a column of averages over an
            // empty table is full of it rather than of infinities.
            if there == 0.0 {
                return Value::Error(Error::DivideByZero);
            }
            here / there
        }
        Operator::Power => {
            let result = here.powf(there);
            if result.is_nan() {
                return Value::Error(Error::Number);
            }
            result
        }
        _ => return Value::Error(Error::Value),
    };

    if value.is_nan() {
        return Value::Error(Error::Number);
    }
    if value.is_infinite() {
        return Value::Error(Error::Number);
    }

    Value::Number(value)
}

/// Subtraction with Excel's last-step correction.
///
/// `=0.1+0.2-0.3` is nought on screen in every spreadsheet and 5.55e-17 in
/// every language. Excel gets there by looking at the result of a subtraction
/// whose operands are close: if what is left is nothing but the error the
/// representation itself introduced, it is nothing.
fn subtract(left: f64, right: f64) -> f64 {
    let result = left - right;
    if result == 0.0 {
        return 0.0;
    }

    let largest = left.abs().max(right.abs());
    if largest == 0.0 {
        return result;
    }

    // Fifteen significant digits is what a spreadsheet keeps; anything below
    // the last of them is the representation talking rather than the numbers.
    if (result.abs() / largest) < 1e-15 {
        return 0.0;
    }

    round_to_significant(result, 15)
}

/// The value of a reference: one cell, or the rectangle it names.
fn resolve(reference: &Reference, context: &Context<'_>) -> Value {
    rect_of(reference, context).value(context)
}

/// The rectangle a reference names, before anything has been read.
///
/// A whole column is not a million cells: it is the cells that are there, and
/// only the caller knows how far that reaches.
pub fn rect_of(reference: &Reference, context: &Context<'_>) -> Rect {
    let sheet = reference.sheet.as_ref().map(|(first, _)| first.clone());
    let named = sheet.as_deref();

    match &reference.kind {
        ReferenceKind::Cell { row, column } => Rect::cell(sheet, row.index, column.index),

        ReferenceKind::Range { from, to } => Rect {
            sheet,
            top: from.0.index.min(to.0.index),
            bottom: from.0.index.max(to.0.index),
            left: from.1.index.min(to.1.index),
            right: from.1.index.max(to.1.index),
        },

        ReferenceKind::Columns { from, to } => {
            let (rows, _) = context.cells.extent(named);
            Rect {
                sheet,
                top: 0,
                bottom: (rows - 1).max(0),
                left: from.index.min(to.index),
                right: from.index.max(to.index),
            }
        }

        ReferenceKind::Rows { from, to } => {
            let (_, columns) = context.cells.extent(named);
            Rect {
                sheet,
                top: from.index.min(to.index),
                bottom: from.index.max(to.index),
                left: 0,
                right: (columns - 1).max(0),
            }
        }
    }
}

/// The rectangle an argument names, if it names one at all.
///
/// A reference is written as one, or worked out by a function that answers
/// with a place rather than a value. Anything else — a number, a sum, a piece
/// of text — names nothing, and the functions that need a place say so.
pub fn reference_of(expression: &Expr, context: &Context<'_>) -> Option<Rect> {
    match expression {
        Expr::Reference(reference) => Some(rect_of(reference, context)),
        Expr::Parenthesised(inside) => reference_of(inside, context),
        Expr::Call { name, arguments } => crate::functions::reference(name, arguments, context),
        _ => None,
    }
}

fn rectangle(
    context: &Context<'_>,
    sheet: Option<&str>,
    top: i64,
    bottom: i64,
    left: i64,
    right: i64,
) -> Value {
    let rows = (bottom - top + 1).max(0) as usize;
    let columns = (right - left + 1).max(0) as usize;

    let mut values = Vec::with_capacity(rows * columns);
    for row in top..=bottom {
        for column in left..=right {
            values.push(context.cells.value_at(sheet, row, column));
        }
    }

    let array = Array::new(rows, columns, values);
    // A range of one cell is that cell: `=A1:A1` is `=A1`, and handing back an
    // array of one would make every caller unwrap it.
    match array.only() {
        Some(value) => value.clone(),
        None => Value::Array(array),
    }
}

/// `:`, a space, and `,` — the operators that work on references.
///
/// Only the range operator is worked out here; the other two need the shape of
/// what they are given rather than its values, and the parser hands them over
/// as trees. What they come to is the next piece of the engine, so they say
/// `#NULL!` rather than pretending.
fn reference_operator(
    operator: Operator,
    left: &Expr,
    right: &Expr,
    context: &Context<'_>,
) -> Value {
    if operator != Operator::Range {
        return Value::Error(Error::Null);
    }

    let (Expr::Reference(first), Expr::Reference(second)) = (left, right) else {
        return Value::Error(Error::Value);
    };

    let (
        ReferenceKind::Cell {
            row: top,
            column: leftmost,
        },
        ReferenceKind::Cell {
            row: bottom,
            column: rightmost,
        },
    ) = (&first.kind, &second.kind)
    else {
        return Value::Error(Error::Value);
    };

    let sheet = first.sheet.as_ref().map(|(name, _)| name.as_str());
    rectangle(
        context,
        sheet,
        top.index.min(bottom.index),
        top.index.max(bottom.index),
        leftmost.index.min(rightmost.index),
        leftmost.index.max(rightmost.index),
    )
}
