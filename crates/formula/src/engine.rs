//! A sheet of cells that keeps itself up to date.
//!
//! The graph says what has to be worked out again and in what order; this
//! holds the cells, walks that order, and hands back what changed. It is the
//! whole of what a spreadsheet does between a keystroke and a new number on
//! screen.
//!
//! Only what changed comes back. A workbook of a million formulas where
//! somebody typed into one cell has a handful of dependants, and repainting
//! the other million would be the slowest possible way to be right.

use std::collections::HashMap;

use crate::ast::Expr;
use crate::eval::{evaluate, Cells, Context};
use crate::graph::{precedents_of, CellId, Graph};
use crate::parser::{parse, ParseError};
use crate::value::Value;

/// What is in a cell: something typed, or something worked out.
#[derive(Debug, Clone)]
enum Content {
    Value(Value),
    Formula { text: String, tree: Expr },
}

#[derive(Default)]
pub struct Engine {
    contents: HashMap<CellId, Content>,
    /// What each cell currently shows, formulas included.
    values: HashMap<CellId, Value>,
    graph: Graph,
    /// How far each sheet reaches, for `A:A` and its kind.
    extents: HashMap<String, (i64, i64)>,
}

/// What a change came to: the cells that now show something else.
#[derive(Debug, Default, PartialEq)]
pub struct Changed {
    pub cells: Vec<(CellId, Value)>,
    /// Cells that depend on themselves; Excel warns and leaves them at nought.
    pub circular: Vec<CellId>,
}

impl Engine {
    pub fn new() -> Self {
        Self::default()
    }

    /// A cell with something typed in it.
    pub fn set_value(&mut self, sheet: &str, row: i64, column: i64, value: Value) -> Changed {
        let cell = (sheet.to_string(), row, column);

        self.graph.remove(&cell);
        self.contents
            .insert(cell.clone(), Content::Value(value.clone()));
        self.values.insert(cell.clone(), value);
        self.grow(sheet, row, column);

        self.recalculate_from(&[cell])
    }

    /// A cell with a formula in it, which is worked out at once.
    ///
    /// A formula that will not parse is refused rather than stored: what the
    /// caller does about that — keep the text, show the error — is a question
    /// about a window rather than about arithmetic.
    pub fn set_formula(
        &mut self,
        sheet: &str,
        row: i64,
        column: i64,
        text: &str,
    ) -> Result<Changed, ParseError> {
        let tree = parse(text)?;
        let cell = (sheet.to_string(), row, column);

        self.graph.set(cell.clone(), precedents_of(&tree, sheet));
        self.contents.insert(
            cell.clone(),
            Content::Formula {
                text: text.to_string(),
                tree,
            },
        );
        self.grow(sheet, row, column);

        Ok(self.recalculate_from(&[cell]))
    }

    /// A cell emptied.
    pub fn clear(&mut self, sheet: &str, row: i64, column: i64) -> Changed {
        let cell = (sheet.to_string(), row, column);

        self.graph.remove(&cell);
        self.contents.remove(&cell);
        self.values.remove(&cell);

        self.recalculate_from(&[cell])
    }

    /// What a cell shows.
    pub fn value(&self, sheet: &str, row: i64, column: i64) -> Value {
        self.values
            .get(&(sheet.to_string(), row, column))
            .cloned()
            .unwrap_or(Value::Blank)
    }

    /// The formula in a cell, as it was written.
    pub fn formula(&self, sheet: &str, row: i64, column: i64) -> Option<&str> {
        match self.contents.get(&(sheet.to_string(), row, column)) {
            Some(Content::Formula { text, .. }) => Some(text),
            _ => None,
        }
    }

    /// Everything worked out again, in order — what a file asks for on open.
    ///
    /// The typed values are put back first. A full recalculation is what
    /// somebody asks for when they no longer trust what is on screen, and
    /// starting from the cells as they were typed is what makes it an answer
    /// rather than another pass over the same suspicion.
    pub fn recalculate(&mut self) -> Changed {
        for (cell, content) in &self.contents {
            if let Content::Value(value) = content {
                self.values.insert(cell.clone(), value.clone());
            }
        }

        let formulas: Vec<CellId> = self.graph.formulas().cloned().collect();
        self.recalculate_from(&formulas)
    }

    /// The cells that changed, worked out in an order that respects the graph.
    fn recalculate_from(&mut self, changed: &[CellId]) -> Changed {
        let mut result = Changed::default();

        // The cell that was typed into has changed by definition; the rest
        // have to be worked out to find out.
        for cell in changed {
            if let Some(value) = self.values.get(cell) {
                result.cells.push((cell.clone(), value.clone()));
            } else {
                result.cells.push((cell.clone(), Value::Blank));
            }
        }

        let plan = self.graph.order_from(changed);

        for cell in plan.order {
            // A formula the graph knows about but the sheet does not is one
            // that was just taken out; skipping it is not an error.
            let Some(Content::Formula { tree, .. }) = self.contents.get(&cell).cloned() else {
                continue;
            };

            let value = {
                let view = View {
                    engine: self,
                    sheet: cell.0.clone(),
                };
                evaluate(
                    &tree,
                    &Context {
                        cells: &view,
                        at: (cell.1, cell.2),
                    },
                )
            };

            let before = self.values.get(&cell);
            if before != Some(&value) {
                self.values.insert(cell.clone(), value.clone());
                result.cells.push((cell, value));
            }
        }

        // A cell in a cycle shows nought, as Excel leaves it, and is named so
        // the caller can say why.
        for cell in &plan.circular {
            self.values.insert(cell.clone(), Value::Number(0.0));
            result.cells.push((cell.clone(), Value::Number(0.0)));
        }
        result.circular = plan.circular;

        result
    }

    fn grow(&mut self, sheet: &str, row: i64, column: i64) {
        let extent = self.extents.entry(sheet.to_string()).or_insert((0, 0));
        extent.0 = extent.0.max(row + 1);
        extent.1 = extent.1.max(column + 1);
    }
}

/// The engine as the evaluator sees it: cells, and how far they reach.
struct View<'a> {
    engine: &'a Engine,
    /// The sheet a reference with no name of its own means.
    sheet: String,
}

impl Cells for View<'_> {
    fn value_at(&self, sheet: Option<&str>, row: i64, column: i64) -> Value {
        let on = sheet.unwrap_or(&self.sheet);
        self.engine.value(on, row, column)
    }

    fn extent(&self, sheet: Option<&str>) -> (i64, i64) {
        let on = sheet.unwrap_or(&self.sheet);
        self.engine.extents.get(on).copied().unwrap_or((0, 0))
    }
}
