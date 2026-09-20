//! Where a table is, and what its columns are called.
//!
//! A structured reference — `Table1[Amount]` — is written the way it is so
//! that it survives rows being put in around it, which an `A1` reference does
//! not. The price of that is that the formula no longer says where it points:
//! where `Table1` is is a fact about the workbook, and the engine has to be
//! told (`Cells::area_of`).
//!
//! Resolving one is here rather than in whoever does the telling, so that the
//! rules — a header is a label rather than a figure, `#All` includes it,
//! `[@Amount]` is the part of a column on one row — are written once.

use crate::ast::Structured;
use crate::eval::Rect;

/// A table on a sheet: where it sits and what its columns are called.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Table {
    /// `Table1` — the name a formula uses, which is not the display name.
    pub name: String,
    /// The sheet it is on. A formula may name a table on another sheet, so
    /// the answer has to carry where it is rather than assume it is here.
    pub sheet: String,
    pub top: i64,
    pub bottom: i64,
    pub left: i64,
    pub right: i64,
    /// Usually one. A table can say it has no header row at all.
    pub header_rows: i64,
    pub totals_rows: i64,
    /// In order, left to right.
    pub columns: Vec<String>,
}

/// The rectangle a structured reference names, among the tables of a workbook.
///
/// Nothing when the table, or the column, is one nobody has heard of — which
/// is `#REF!` where it is asked, and is the right answer: a column that was
/// renamed leaves every formula that named it pointing at nothing, and
/// saying so is more use than guessing which column was meant.
pub fn area_of(tables: &[Table], reference: &Structured, at: (i64, i64)) -> Option<Rect> {
    let table = match &reference.table {
        Some(name) => tables
            .iter()
            .find(|table| table.name.eq_ignore_ascii_case(name))?,
        // No name at all means the table the formula is sitting in.
        None => tables
            .iter()
            .find(|table| at.0 >= table.top && at.0 <= table.bottom)?,
    };

    let says = |part: &str| {
        reference
            .parts
            .iter()
            .any(|written| written.eq_ignore_ascii_case(part))
    };

    let first_data = table.top + table.header_rows;
    let last_data = table.bottom - table.totals_rows;

    // `#All`, and the pair of `#Headers` and `#Totals` together, both mean
    // the whole of it — one says so and the other says both ends of it.
    let (mut top, mut bottom) = if says("All") || (says("Headers") && says("Totals")) {
        (table.top, table.bottom)
    } else if says("Headers") {
        (table.top, first_data - 1)
    } else if says("Totals") {
        (last_data + 1, table.bottom)
    } else {
        // What a table reference means unless it says otherwise: the figures,
        // without the label over them or the total under them.
        (first_data, last_data)
    };

    // One row of it, which is what a calculated column is written as.
    if reference.this_row {
        top = at.0;
        bottom = at.0;
    }

    if top > bottom {
        return None;
    }

    let (left, right) = match reference.columns.len() {
        0 => (table.left, table.right),
        _ => {
            let mut edges = Vec::new();
            for column in &reference.columns {
                let at = table
                    .columns
                    .iter()
                    .position(|name| name.eq_ignore_ascii_case(column))?;
                edges.push(table.left + at as i64);
            }

            // Two of them is a span, and a span is written either way round.
            (*edges.iter().min()?, *edges.iter().max()?)
        }
    };

    Some(Rect {
        sheet: Some(table.sheet.clone()),
        top,
        bottom,
        left,
        right,
    })
}
