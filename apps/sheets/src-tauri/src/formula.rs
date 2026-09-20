//! The seam between a window and the formula engine.
//!
//! The engine (`crates/formula`) is a pure library: it is handed cells and
//! asked for values, and it has never heard of a file, a window or Tauri.
//! This is the other half of that decision — the place where a workbook on
//! screen is kept in step with one in memory, and the only place in the app
//! that knows both.
//!
//! One engine per open workbook, held between calls. Sending a sheet across
//! for every keystroke would mean the graph was rebuilt for every keystroke,
//! and the whole point of a dependency graph is that it is built once and
//! walked many times.
//!
//! What comes back is only what changed. A workbook of a million formulas
//! where somebody typed into one cell has a handful of dependants, and the
//! window repaints those rather than all of it.

use std::collections::HashMap;
use std::sync::Mutex;

use formula::date::DateSystem;
use formula::engine::{Edit, Engine};
use formula::value::{Error, Value};

/// The engines, one per workbook, keyed by whatever the window calls it.
#[derive(Default)]
pub struct Workbooks(Mutex<HashMap<String, Engine>>);

/// A value, in the shapes JSON can carry one.
///
/// Tagged rather than guessed at from the JSON type: a cell holding the text
/// "5" and a cell holding the number 5 are different cells, and a wire format
/// that could not tell them apart would lose the difference on the way over.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Held {
    Number { number: f64 },
    Text { text: String },
    Boolean { boolean: bool },
    Error { text: String },
    Blank,
}

impl From<Held> for Value {
    fn from(held: Held) -> Self {
        match held {
            Held::Number { number } => Value::Number(number),
            Held::Text { text } => Value::Text(text),
            Held::Boolean { boolean } => Value::Bool(boolean),
            Held::Error { text } => Value::Error(Error::from_text(&text).unwrap_or(Error::Value)),
            Held::Blank => Value::Blank,
        }
    }
}

impl From<&Value> for Held {
    fn from(value: &Value) -> Self {
        match value {
            Value::Number(number) => Held::Number { number: *number },
            Value::Text(text) => Held::Text { text: text.clone() },
            Value::Bool(boolean) => Held::Boolean { boolean: *boolean },
            Value::Error(error) => Held::Error {
                text: error.text().to_string(),
            },
            Value::Blank => Held::Blank,
            // An array in a cell is a spilled formula, which the engine does
            // not write yet (`PLAN.md`, dynamic arrays). Its top left is what
            // Excel shows in the cell that holds the formula.
            Value::Array(array) => match array.values.first() {
                Some(first) => Held::from(first),
                None => Held::Blank,
            },
        }
    }
}

/// A cell as the window describes one: what is in it, and what works it out.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellInput {
    pub row: i64,
    pub column: i64,
    /// The formula without its `=`, or nothing for a cell somebody typed into.
    #[serde(default)]
    pub formula: Option<String>,
    /// What the cell shows: the file's cached value for a formula.
    pub value: Held,
}

/// One sheet's worth of cells, named by the part path the window uses.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetInput {
    pub sheet: String,
    pub cells: Vec<CellInput>,
    /// Rows a filter has hidden, and rows somebody hid by hand.
    ///
    /// Two lists rather than one, because `SUBTOTAL` can tell them apart and
    /// the sheet cannot: a row's `hidden` flag says it is out of sight and
    /// not why, which is exactly what the file records and exactly what a
    /// formula needs told.
    #[serde(default)]
    pub filtered: Vec<i64>,
    #[serde(default)]
    pub hidden: Vec<i64>,
}

/// Where a cell is.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub sheet: String,
    pub row: i64,
    pub column: i64,
}

/// A cell that now shows something else.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub sheet: String,
    pub row: i64,
    pub column: i64,
    pub value: Held,
    /// The formula this came from, when it was not this cell's own.
    ///
    /// A cell nobody typed in has appeared, because a formula somewhere else
    /// gave an answer too big to fit in its own cell. The window has to make
    /// the cell, and has to know it belongs to the other one.
    pub spilled_from: Option<Place>,
    /// Whether a spill has let this cell go, and it is empty again.
    pub emptied: bool,
}

/// What a change came to.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub cells: Vec<Outcome>,
    /// Cells that depend on themselves. Excel warns and leaves them at
    /// nought; the warning belongs to whoever has a window.
    pub circular: Vec<Place>,
    /// Why a formula was refused, when it was. The window keeps the text and
    /// says so rather than storing something it cannot work out.
    pub refused: Option<String>,
}

impl Report {
    fn of(changed: formula::engine::Changed) -> Self {
        let spilled: HashMap<_, _> = changed.spilled.iter().cloned().collect();
        let emptied: std::collections::HashSet<_> = changed.emptied.iter().cloned().collect();

        Self {
            cells: changed
                .cells
                .iter()
                .map(|(at, value)| {
                    let (sheet, row, column) = at;
                    Outcome {
                        sheet: sheet.clone(),
                        row: *row,
                        column: *column,
                        value: Held::from(value),
                        spilled_from: spilled.get(at).map(|(sheet, row, column)| Place {
                            sheet: sheet.clone(),
                            row: *row,
                            column: *column,
                        }),
                        emptied: emptied.contains(at),
                    }
                })
                .collect(),
            circular: changed
                .circular
                .iter()
                .map(|(sheet, row, column)| Place {
                    sheet: sheet.clone(),
                    row: *row,
                    column: *column,
                })
                .collect(),
            refused: None,
        }
    }
}

/// A workbook loaded, without anything being worked out.
///
/// The numbers in a file are the ones the program that wrote it worked out,
/// and they are trusted until somebody types — which is what Excel does and
/// what makes a large workbook open at once rather than after a recalculation
/// nobody asked for.
#[tauri::command]
pub fn formula_open(
    books: tauri::State<'_, Workbooks>,
    book: String,
    sheets: Vec<SheetInput>,
    moment: f64,
    date1904: bool,
    seed: u64,
) -> Result<(), String> {
    let mut engine = Engine::new();
    engine.set_moment(moment);
    engine.set_date_system(if date1904 {
        DateSystem::Excel1904
    } else {
        DateSystem::Excel1900
    });
    engine.seed_random(seed);

    for sheet in sheets {
        engine.set_out_of_sight(&sheet.sheet, sheet.filtered, sheet.hidden);

        for cell in sheet.cells {
            let value = Value::from(cell.value);
            match cell.formula {
                // A formula the engine cannot read is left as the file wrote
                // it: a workbook using something unimplemented must not
                // become a workbook this program has damaged.
                Some(text) => {
                    let _ = engine.load_formula(&sheet.sheet, cell.row, cell.column, &text, value);
                }
                None => engine.load_value(&sheet.sheet, cell.row, cell.column, value),
            }
        }
    }

    books.engines()?.insert(book, engine);
    Ok(())
}

/// A cell typed into.
#[tauri::command]
pub fn formula_set(
    books: tauri::State<'_, Workbooks>,
    book: String,
    sheet: String,
    row: i64,
    column: i64,
    input: CellInput,
) -> Result<Report, String> {
    let mut engines = books.engines()?;
    let engine = engines.get_mut(&book).ok_or_else(unopened)?;

    match input.formula {
        Some(text) => match engine.set_formula(&sheet, row, column, &text) {
            Ok(changed) => Ok(Report::of(changed)),
            Err(error) => Ok(Report {
                refused: Some(error.to_string()),
                ..Report::default()
            }),
        },
        None => Ok(Report::of(engine.set_value(
            &sheet,
            row,
            column,
            Value::from(input.value),
        ))),
    }
}

/// A cell as the window names one when it sends a batch of them.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placed {
    pub sheet: String,
    pub row: i64,
    pub column: i64,
    /// Nothing at all for a cell that was emptied.
    #[serde(default)]
    pub input: Option<CellInput>,
}

/// Many cells at once, worked out once at the end.
///
/// What a paste is, and a fill, and an undo of either. One call rather than a
/// hundred thousand, and one walk of the graph rather than a hundred thousand
/// walks over ground the next one covers again.
#[tauri::command]
pub fn formula_set_many(
    books: tauri::State<'_, Workbooks>,
    book: String,
    cells: Vec<Placed>,
) -> Result<Report, String> {
    let mut engines = books.engines()?;
    let engine = engines.get_mut(&book).ok_or_else(unopened)?;

    let edits = cells
        .into_iter()
        .map(|placed| {
            let at = (placed.sheet, placed.row, placed.column);
            let edit = match placed.input {
                None => Edit::Empty,
                Some(CellInput {
                    formula: Some(text),
                    ..
                }) => Edit::Formula(text),
                Some(CellInput { value, .. }) => Edit::Value(Value::from(value)),
            };
            (at, edit)
        })
        .collect();

    let applied = engine.set_many(edits);
    let mut report = Report::of(applied.changed);

    // A formula nobody could read is named, so the window can keep what was
    // typed rather than showing a number the text does not justify.
    if let Some((sheet, row, column)) = applied.refused.first() {
        report.refused = Some(format!("{sheet}!{row},{column}"));
    }

    Ok(report)
}

/// Which rows are out of sight, and why.
///
/// What a filter changes, and the one thing a total is about that no value
/// can answer. Only the totals are worked out again: nothing else on a sheet
/// cares whether a row is hidden.
#[tauri::command]
pub fn formula_out_of_sight(
    books: tauri::State<'_, Workbooks>,
    book: String,
    sheet: String,
    filtered: Vec<i64>,
    hidden: Vec<i64>,
) -> Result<Report, String> {
    let mut engines = books.engines()?;
    let engine = engines.get_mut(&book).ok_or_else(unopened)?;

    engine.set_out_of_sight(&sheet, filtered, hidden);
    Ok(Report::of(engine.recalculate_totals()))
}

/// A cell emptied.
#[tauri::command]
pub fn formula_clear(
    books: tauri::State<'_, Workbooks>,
    book: String,
    sheet: String,
    row: i64,
    column: i64,
) -> Result<Report, String> {
    let mut engines = books.engines()?;
    let engine = engines.get_mut(&book).ok_or_else(unopened)?;

    Ok(Report::of(engine.clear(&sheet, row, column)))
}

/// Everything worked out again — `F9`, and a file that asks for it on open.
#[tauri::command]
pub fn formula_recalculate(
    books: tauri::State<'_, Workbooks>,
    book: String,
    moment: f64,
) -> Result<Report, String> {
    let mut engines = books.engines()?;
    let engine = engines.get_mut(&book).ok_or_else(unopened)?;

    engine.set_moment(moment);
    Ok(Report::of(engine.recalculate()))
}

/// What one cell holds, for a window that has lost track of it.
#[tauri::command]
pub fn formula_value(
    books: tauri::State<'_, Workbooks>,
    book: String,
    sheet: String,
    row: i64,
    column: i64,
) -> Result<Held, String> {
    let engines = books.engines()?;
    let engine = engines.get(&book).ok_or_else(unopened)?;

    Ok(Held::from(&engine.value(&sheet, row, column)))
}

/// A workbook closed: the engine goes with the window.
#[tauri::command]
pub fn formula_close(books: tauri::State<'_, Workbooks>, book: String) -> Result<(), String> {
    books.engines()?.remove(&book);
    Ok(())
}

impl Workbooks {
    /// The engines, or why they could not be reached.
    ///
    /// A poisoned lock means a panic happened inside a command that held it,
    /// and the honest answer is to say so rather than to carry on with a map
    /// nobody can vouch for.
    fn engines(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Engine>>, String> {
        self.0
            .lock()
            .map_err(|_| "the formula engine was left in an unknown state".to_string())
    }
}

fn unopened() -> String {
    "that workbook has no formula engine open".to_string()
}
