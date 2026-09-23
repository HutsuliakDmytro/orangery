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

use std::sync::Arc;

use crate::ast::{Expr, Operator, Structured};
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

    /// The sheets a 3-D reference covers, in the workbook's own order.
    ///
    /// `Sheet1:Sheet3!B1` is one reference over every sheet from the first to
    /// the last, and which those are is a fact about the workbook. A caller
    /// that has not been told the order says so by leaving this alone, and
    /// what is left is the two ends — which is what can be read without it.
    fn sheets_across(&self, first: &str, last: &str) -> Vec<String> {
        if first.eq_ignore_ascii_case(last) {
            vec![first.to_string()]
        } else {
            vec![first.to_string(), last.to_string()]
        }
    }

    /// How far a sheet reaches, for `A:A` and the rest.
    ///
    /// A whole column is not a million cells: it is the cells that are there,
    /// and asking the caller is the only way to know which those are.
    fn extent(&self, sheet: Option<&str>) -> (i64, i64) {
        let _ = sheet;
        (0, 0)
    }

    /// What a defined name stands for.
    ///
    /// A name in a workbook is a formula somebody has given a name to —
    /// usually a range, sometimes a number, occasionally a whole expression.
    /// The engine is handed the tree rather than the text so that a name used
    /// in ten thousand cells is parsed once.
    fn defined(&self, name: &str) -> Option<Arc<Expr>> {
        let _ = name;
        None
    }

    /// Where a table's column is, in cells.
    ///
    /// `Table1[Amount]` survives rows being inserted, which is the whole
    /// point of writing it that way — and means the engine cannot know where
    /// it is. Only whoever holds the workbook does.
    ///
    /// `at` is where the formula is, for the `[@Amount]` form, which means
    /// the part of that column on this row.
    fn area_of(&self, reference: &Structured, at: (i64, i64)) -> Option<Rect> {
        let _ = (reference, at);
        None
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

    /// The same rectangle, read from another sheet.
    pub fn on(mut self, sheet: String) -> Self {
        self.sheet = Some(sheet);
        self
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
    /// Whether a range used here is reduced to the one cell that lines up.
    ///
    /// True inside a formula the file did not mark as an array — no `cm="1"`,
    /// no `t="array"` — and only where a single value is what is wanted. That
    /// is implicit intersection, the rule every spreadsheet used before
    /// dynamic arrays: `=A2:A5` in `F3` is `=A3`, and `=A2:A5` in a cell no
    /// row of it lines up with is `#VALUE!`.
    ///
    /// False for an array formula, for a dynamic one, and inside any function
    /// that takes a range — `SUM(A1:A5)` wants the five cells, not the one
    /// beside it.
    pub intersect: bool,
    /// Whether what is being worked out is a function's range argument.
    ///
    /// Only there is a reference across sheets a thing that can be read:
    /// `SUM(Sheet1:Sheet3!A1)` adds three cells, and `=Sheet1:Sheet3!A1` in a
    /// cell of its own is three answers with no way to choose between them,
    /// which Excel calls `#VALUE!`.
    pub ranges_wanted: bool,
}

impl<'a> Context<'a> {
    /// The same context, with ranges left whole.
    ///
    /// What a function that takes a range is given. The default is the other
    /// way around because the default is what the formula itself is: a value.
    pub fn for_range(&self) -> Context<'a> {
        Context {
            cells: self.cells,
            at: self.at,
            intersect: false,
            ranges_wanted: true,
        }
    }

    /// The same context, with ranges reduced to the cell that lines up.
    pub fn for_value(&self) -> Context<'a> {
        Context {
            cells: self.cells,
            at: self.at,
            intersect: true,
            ranges_wanted: false,
        }
    }
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

        // Where `Table1[Amount]` is depends on where the table is, which is
        // a fact about the workbook rather than about the formula. A caller
        // that has not been asked about tables says so by not answering, and
        // `#REF!` is what a reference to a table nobody has heard of means.
        Expr::Structured(structured) => match context.cells.area_of(structured, context.at) {
            Some(rect) => rect.value(context),
            None => Value::Error(Error::Reference),
        },

        Expr::Implicit(inside) => implicit(inside, context),

        // A defined name is a formula with a name on it, which is what makes
        // `=Tax_Rate` readable where `=Sheet2!$B$1` is not. Worked out where
        // it was used rather than where it was defined, because a name may be
        // written relatively and then means something different in every cell
        // that uses it — which is how a name like `ThisRowAbove` works at all.
        //
        // A name nothing has defined is `#NAME?`: the formula is kept, and
        // the answer says plainly that this program did not know the word.
        Expr::Name(name) => match context.cells.defined(name) {
            Some(meaning) => evaluate(&meaning, context),
            None => Value::Error(Error::Name),
        },

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
    // A reference that reaches across sheets is read from each of them, and
    // the values come back as one array — which is what `SUM`, `COUNT`, `MIN`
    // and the rest of the functions that take one are given.
    if let Some((first, last)) = &reference.sheet {
        let across = context.cells.sheets_across(first, last);

        if across.len() > 1 {
            return across_sheets(reference, &across, context);
        }
    }

    let rect = rect_of(reference, context);

    match intersected(&rect, context) {
        Intersection::Whole => rect.value(context),
        Intersection::At(one) => one.value(context),
        Intersection::None => Value::Error(Error::Value),
    }
}

/// A 3-D reference's values, sheet by sheet, as one array.
///
/// Handed to `SUM`, the values of the three sheets are what it adds. Anywhere
/// else it is `#VALUE!`, as Excel has it: `=Sheet1:Sheet3!B1` written in a
/// cell has three answers and no way to choose between them.
fn across_sheets(reference: &Reference, sheets: &[String], context: &Context<'_>) -> Value {
    // Anywhere but a function's range argument, three sheets' worth of answers
    // is not an answer.
    if !context.ranges_wanted {
        return Value::Error(Error::Value);
    }

    let mut values = Vec::new();

    for sheet in sheets {
        let rect = rect_of(reference, context).on(sheet.clone());

        match rect.value(context) {
            Value::Array(array) => values.extend(array.values),
            one => values.push(one),
        }
    }

    let rows = values.len();
    Value::Array(Array::new(rows, 1, values))
}

/// What implicit intersection makes of a rectangle.
enum Intersection {
    /// Left as it is: an array formula, or a function that wants the range.
    Whole,
    /// The one cell of it that lines up with the formula.
    At(Rect),
    /// Nothing lines up, which Excel answers `#VALUE!`.
    None,
}

/// A range reduced to the cell in the formula's own row or column.
///
/// The rule is Excel's, from before dynamic arrays and still what a file
/// written without `cm="1"` means: a range used where one value is wanted
/// gives the cell of it that shares the formula's row, or its column, or both.
/// A range that shares neither is `#VALUE!` — the formula is pointing at cells
/// it has no line to.
fn intersected(rect: &Rect, context: &Context<'_>) -> Intersection {
    if !context.intersect || (rect.height() <= 1 && rect.width() <= 1) {
        return Intersection::Whole;
    }

    let (row, column) = context.at;

    let taken_row = if rect.height() > 1 {
        if row < rect.top || row > rect.bottom {
            return Intersection::None;
        }
        row
    } else {
        rect.top
    };

    let taken_column = if rect.width() > 1 {
        if column < rect.left || column > rect.right {
            return Intersection::None;
        }
        column
    } else {
        rect.left
    };

    Intersection::At(Rect::cell(rect.sheet.clone(), taken_row, taken_column))
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

/// The one value of a range that lines up with the formula asking.
///
/// Excel's `@`, which it writes in front of anything that could spill but
/// should not — that is how a workbook written in 365 still opens in 2013 and
/// means the same thing. A column is read across the formula's own row, a row
/// down its own column, and a block has no single value to give.
fn implicit(inside: &Expr, context: &Context<'_>) -> Value {
    let Some(rect) = reference_of(inside, context) else {
        // Not a place but a value: `@` in front of one is nothing to do.
        return match evaluate(inside, context) {
            Value::Array(array) => array.values.first().cloned().unwrap_or(Value::Blank),
            value => value,
        };
    };

    let (row, column) = context.at;

    if rect.height() == 1 && rect.width() == 1 {
        return rect.value(context);
    }

    if rect.width() == 1 && (rect.top..=rect.bottom).contains(&row) {
        return context
            .cells
            .value_at(rect.sheet.as_deref(), row, rect.left);
    }

    if rect.height() == 1 && (rect.left..=rect.right).contains(&column) {
        return context
            .cells
            .value_at(rect.sheet.as_deref(), rect.top, column);
    }

    // Excel's answer when the formula is not beside the range it is asking
    // about, and there is no row to meet it on.
    Value::Error(Error::Value)
}

/// The rectangle an argument names, if it names one at all.
///
/// A reference is written as one, or worked out by a function that answers
/// with a place rather than a value. Anything else — a number, a sum, a piece
/// of text — names nothing, and the functions that need a place say so.
pub fn reference_of(expression: &Expr, context: &Context<'_>) -> Option<Rect> {
    match expression {
        Expr::Reference(reference) => Some(rect_of(reference, context)),
        Expr::Structured(structured) => context.cells.area_of(structured, context.at),
        // A name standing for a range is a range: `SUM(Sales)` has to reach
        // the cells rather than a copy of their values.
        Expr::Name(name) => {
            let meaning = context.cells.defined(name)?;
            reference_of(meaning.as_ref(), context)
        }
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
