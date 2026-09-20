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

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::ast::Expr;
use crate::date::DateSystem;
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
    /// What time it is, as the workbook counts time.
    moment: f64,
    /// Which morning the workbook counts days from.
    system: DateSystem,
    /// Where `RAND` gets its answers.
    ///
    /// A sequence rather than a source of entropy: the seed comes from
    /// outside, so a workbook recalculated twice from the same seed comes out
    /// the same twice, and nothing in the library has to ask the operating
    /// system for anything.
    chance: AtomicU64,
}

/// What one cell is being made into.
#[derive(Debug, Clone)]
pub enum Edit {
    Value(Value),
    /// A formula, without its leading `=`.
    Formula(String),
    Empty,
}

/// What a batch of edits came to.
#[derive(Debug, Default, PartialEq)]
pub struct Applied {
    pub changed: Changed,
    /// The cells whose formula could not be read at all.
    pub refused: Vec<CellId>,
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
        Self {
            chance: AtomicU64::new(0x2545_f491_4f6c_dd1d),
            ..Default::default()
        }
    }

    /// What time the workbook is being worked out at, for `NOW` and `TODAY`.
    ///
    /// Told rather than read off a clock: the engine is a library, and a
    /// library that knew the time could not be asked the same question twice.
    pub fn set_moment(&mut self, serial: f64) {
        self.moment = serial;
    }

    /// Which morning this workbook counts days from — `date1904` in the file.
    pub fn set_date_system(&mut self, system: DateSystem) {
        self.system = system;
    }

    /// Where the random numbers start from.
    pub fn seed_random(&mut self, seed: u64) {
        self.chance = AtomicU64::new(if seed == 0 { 1 } else { seed });
    }

    /// The next number in the sequence, from nought up to but not one.
    fn next_chance(&self) -> f64 {
        // xorshift64*: three shifts and a multiply, no dependencies, and the
        // same sequence on every platform — which is what makes a workbook
        // recalculated on a Mac and on Windows agree about a column of
        // `RANDBETWEEN`.
        let mut state = self.chance.load(Ordering::Relaxed);
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        self.chance.store(state, Ordering::Relaxed);

        let scrambled = state.wrapping_mul(0x2545_f491_4f6c_dd1d);
        (scrambled >> 11) as f64 / (1u64 << 53) as f64
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

    /// A cell put in place without working anything out.
    ///
    /// What opening a file is. The values in a workbook are the ones the
    /// program that wrote it worked out, and they are trusted until somebody
    /// types — so loading a hundred thousand formulas must not be a hundred
    /// thousand recalculations, each of them reading cells that have not
    /// arrived yet. The caller says when to work it all out, if it ever does.
    pub fn load_value(&mut self, sheet: &str, row: i64, column: i64, value: Value) {
        let cell = (sheet.to_string(), row, column);

        self.graph.remove(&cell);
        self.contents
            .insert(cell.clone(), Content::Value(value.clone()));
        self.values.insert(cell, value);
        self.grow(sheet, row, column);
    }

    /// A formula put in place with the value the file said it came to.
    pub fn load_formula(
        &mut self,
        sheet: &str,
        row: i64,
        column: i64,
        text: &str,
        cached: Value,
    ) -> Result<(), ParseError> {
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
        self.values.insert(cell, cached);
        self.grow(sheet, row, column);

        Ok(())
    }

    /// Many cells at once, worked out once at the end.
    ///
    /// What a paste is, and a fill, and an undo of either. A hundred thousand
    /// cells arriving one at a time would be a hundred thousand walks of the
    /// graph, most of them over ground the next one covers again; this stages
    /// them all and then walks it once from everything that moved.
    ///
    /// A formula that will not parse is named rather than stored. The caller
    /// keeps what was typed — it is the person's own text, and a cell holding
    /// something this program could not read is better than a cell quietly
    /// holding something else.
    pub fn set_many(&mut self, edits: Vec<(CellId, Edit)>) -> Applied {
        let mut moved: Vec<CellId> = Vec::new();
        let mut refused: Vec<CellId> = Vec::new();

        for (cell, edit) in edits {
            match edit {
                Edit::Value(value) => {
                    self.graph.remove(&cell);
                    self.contents
                        .insert(cell.clone(), Content::Value(value.clone()));
                    self.values.insert(cell.clone(), value);
                    self.grow(&cell.0, cell.1, cell.2);
                }

                Edit::Formula(text) => match parse(&text) {
                    Ok(tree) => {
                        self.graph.set(cell.clone(), precedents_of(&tree, &cell.0));
                        self.contents
                            .insert(cell.clone(), Content::Formula { text, tree });
                        self.grow(&cell.0, cell.1, cell.2);
                    }
                    Err(_) => {
                        // Somebody's own text, kept as text.
                        self.graph.remove(&cell);
                        let value = Value::Text(text);
                        self.contents
                            .insert(cell.clone(), Content::Value(value.clone()));
                        self.values.insert(cell.clone(), value);
                        self.grow(&cell.0, cell.1, cell.2);
                        refused.push(cell.clone());
                    }
                },

                Edit::Empty => {
                    self.graph.remove(&cell);
                    self.contents.remove(&cell);
                    self.values.remove(&cell);
                }
            }

            moved.push(cell);
        }

        Applied {
            changed: self.recalculate_from(&moved),
            refused,
        }
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

        // Every volatile formula goes into the plan whatever was typed:
        // `NOW()` is a different time and `OFFSET(A1,B1,0)` may be a
        // different cell, and neither fact is reachable through an edge. They
        // are worked out, not reported — a volatile cell whose answer came
        // out the same is not a cell that changed.
        let mut seeds: Vec<CellId> = changed.to_vec();
        let already: HashSet<CellId> = changed.iter().cloned().collect();
        seeds.extend(
            self.graph
                .volatile()
                .filter(|cell| !already.contains(*cell))
                .cloned(),
        );

        let plan = self.graph.order_from(&seeds);

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

    fn now(&self) -> f64 {
        self.engine.moment
    }

    fn random(&self) -> f64 {
        self.engine.next_chance()
    }

    fn date_system(&self) -> DateSystem {
        self.engine.system
    }
}
