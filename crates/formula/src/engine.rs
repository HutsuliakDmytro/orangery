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
use crate::eval::{evaluate, Cells, Context, Standing};
use crate::graph::{precedents_of, CellId, Graph};
use crate::parser::{parse, ParseError};
use crate::value::{Error, Value};

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
    /// For each formula that spilled, the cells it filled besides its own.
    spills: HashMap<CellId, Vec<CellId>>,
    /// And the other way round, so a cell can say whose answer it is showing.
    spilled_from: HashMap<CellId, CellId>,
    /// The rows nobody can see, and why.
    ///
    /// Not a fact about any cell's value, and not one the engine could work
    /// out: a filter and a hidden row are things done to a sheet. They are
    /// here because `SUBTOTAL` asks about them, and the window is what knows.
    out_of_sight: HashMap<String, (HashSet<i64>, HashSet<i64>)>,
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

    /// Which rows are out of sight on a sheet: hidden by a filter, and
    /// hidden by hand.
    ///
    /// Replaces whatever was said before, because the window always knows the
    /// whole answer and a difference would be more to go wrong than it saves.
    pub fn set_out_of_sight(&mut self, sheet: &str, filtered: Vec<i64>, hidden: Vec<i64>) {
        self.out_of_sight.insert(
            sheet.to_string(),
            (filtered.into_iter().collect(), hidden.into_iter().collect()),
        );
    }

    /// Whether a cell holds a total of its own, which no other total counts.
    fn is_a_total(&self, cell: &CellId) -> bool {
        match self.contents.get(cell) {
            Some(Content::Formula { tree, .. }) => calls_a_total(tree),
            _ => false,
        }
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

    /// Everything that depends on which rows are in sight, worked out again.
    ///
    /// What a filter changes. Only the totals are seeded — nothing else on a
    /// sheet cares whether a row is hidden — so turning a filter on over a
    /// table of a hundred thousand rows recalculates the handful of cells
    /// that are about it rather than the workbook.
    pub fn recalculate_totals(&mut self) -> Changed {
        let totals: Vec<CellId> = self
            .contents
            .iter()
            .filter(|(_, content)| {
                matches!(content, Content::Formula { tree, .. } if calls_a_total(tree))
            })
            .map(|(cell, _)| cell.clone())
            .collect();

        self.recalculate_from(&totals)
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

        // A cell that no longer holds a formula has to give back whatever
        // that formula used to fill: an answer nobody is computing any more
        // must not leave its numbers lying on the sheet.
        for cell in changed {
            if !matches!(self.contents.get(cell), Some(Content::Formula { .. })) {
                for (place, value) in self.clear_spill(cell) {
                    result.cells.push((place, value));
                }
            }
        }

        // And typing into a cell somebody's answer was spilling into breaks
        // that answer, so the formula it came from is worked out again — and
        // will find its way blocked and say so.
        let blocked: Vec<CellId> = changed
            .iter()
            .filter_map(|cell| self.spilled_from.get(cell).cloned())
            .collect();

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
        seeds.extend(blocked);

        // A formula that spills fills cells the graph has no edges for: what
        // depends on the third cell of a spill depends on a cell nobody has
        // written a formula in. So the walk is repeated from whatever a spill
        // moved, until a round moves nothing. Excel does the same thing and
        // calls it a second pass; the bound is here because a spill that
        // feeds itself would otherwise go round for ever, and a workbook that
        // cannot settle is one to stop rather than to hang over.
        let mut pending = seeds;

        for _round in 0..8 {
            let plan = self.graph.order_from(&pending);
            let mut spilled: Vec<CellId> = Vec::new();

            for cell in plan.order {
                // A formula the graph knows about but the sheet does not is
                // one that was just taken out; skipping it is not an error.
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

                let (shown, moved) = self.spill(&cell, value);

                for (place, value) in moved {
                    spilled.push(place.clone());
                    result.cells.push((place, value));
                }

                let before = self.values.get(&cell);
                if before != Some(&shown) {
                    self.values.insert(cell.clone(), shown.clone());
                    result.cells.push((cell, shown));
                }
            }

            // A cell in a cycle shows nought, as Excel leaves it, and is
            // named so the caller can say why.
            for cell in &plan.circular {
                self.values.insert(cell.clone(), Value::Number(0.0));
                result.cells.push((cell.clone(), Value::Number(0.0)));
            }
            if !plan.circular.is_empty() {
                result.circular = plan.circular;
            }

            if spilled.is_empty() {
                break;
            }
            pending = spilled;
        }

        result
    }

    /// A formula's answer put where it belongs, and what that moved.
    ///
    /// One value stays in the cell. An array does not fit in a cell, so it is
    /// written across the ones below and to the right of it — which is the
    /// whole of what a dynamic array is, and the reason a formula can now
    /// change cells nobody typed in.
    ///
    /// Anything already in the way stops it: `#SPILL!` rather than writing
    /// over somebody's work, because a formula that quietly replaced a column
    /// of typed figures would be the worst bug a spreadsheet could have.
    fn spill(&mut self, anchor: &CellId, value: Value) -> (Value, Vec<(CellId, Value)>) {
        let mut moved = self.clear_spill(anchor);

        let Value::Array(array) = &value else {
            return (value, moved);
        };
        // An array of one is a value, and putting it in one cell is what
        // every formula has always done.
        if array.rows <= 1 && array.columns <= 1 {
            let only = array.values.first().cloned().unwrap_or(Value::Blank);
            return (only, moved);
        }

        let mut places = Vec::new();
        for row in 0..array.rows as i64 {
            for column in 0..array.columns as i64 {
                if row == 0 && column == 0 {
                    continue;
                }

                let place = (anchor.0.clone(), anchor.1 + row, anchor.2 + column);
                // Something typed, or somebody else's spill.
                if self.contents.contains_key(&place) || self.spilled_from.contains_key(&place) {
                    return (Value::Error(Error::Spill), moved);
                }

                places.push((place, array.at(row as usize, column as usize).clone()));
            }
        }

        let mut filled = Vec::new();
        for (place, value) in places {
            self.values.insert(place.clone(), value.clone());
            self.spilled_from.insert(place.clone(), anchor.clone());
            filled.push(place.clone());
            moved.push((place, value));
            self.grow(
                &anchor.0,
                anchor.1 + array.rows as i64 - 1,
                anchor.2 + array.columns as i64 - 1,
            );
        }

        self.spills.insert(anchor.clone(), filled);

        (array.values.first().cloned().unwrap_or(Value::Blank), moved)
    }

    /// The cells a formula used to fill, emptied again.
    ///
    /// A spill that shrinks has to give back what it no longer covers, or the
    /// sheet keeps showing numbers from an answer that is no longer true.
    fn clear_spill(&mut self, anchor: &CellId) -> Vec<(CellId, Value)> {
        let Some(filled) = self.spills.remove(anchor) else {
            return Vec::new();
        };

        let mut emptied = Vec::new();
        for place in filled {
            self.spilled_from.remove(&place);

            // Unless somebody has typed there since. Breaking a spill by
            // typing into it is how it usually ends, and taking the typed
            // value away again would be the program arguing with the person
            // about a cell they just filled in.
            if self.contents.contains_key(&place) {
                continue;
            }

            self.values.remove(&place);
            emptied.push((place, Value::Blank));
        }

        emptied
    }

    /// Where a cell's value came from, when it came from somebody else's
    /// formula.
    pub fn spilled_from(&self, sheet: &str, row: i64, column: i64) -> Option<&CellId> {
        self.spilled_from.get(&(sheet.to_string(), row, column))
    }

    /// The rectangle a formula's answer covers, its own cell included.
    pub fn spill_of(&self, sheet: &str, row: i64, column: i64) -> Option<(i64, i64)> {
        let anchor = (sheet.to_string(), row, column);
        let filled = self.spills.get(&anchor)?;

        let bottom = filled.iter().map(|(_, row, _)| *row).max()?;
        let right = filled.iter().map(|(_, _, column)| *column).max()?;

        Some((bottom.max(row), right.max(column)))
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

    fn standing(&self, sheet: Option<&str>, row: i64, column: i64) -> Standing {
        let on = sheet.unwrap_or(&self.sheet);
        let (filtered, hidden) = match self.engine.out_of_sight.get(on) {
            Some((filtered, hidden)) => (filtered.contains(&row), hidden.contains(&row)),
            None => (false, false),
        };

        Standing {
            filtered,
            hidden,
            a_total: self.engine.is_a_total(&(on.to_string(), row, column)),
        }
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

/// Whether a formula takes a total of its own anywhere inside it.
///
/// Anywhere rather than at the top, because `=SUBTOTAL(9,A1:A9)/12` is still
/// a cell holding a subtotal, and a grand total over a column of those would
/// otherwise count every figure twice.
fn calls_a_total(expression: &Expr) -> bool {
    match expression {
        Expr::Call { name, arguments } => {
            let plain = name
                .trim_start_matches("_xlfn.")
                .trim_start_matches("_xlws.")
                .to_ascii_uppercase();

            plain == "SUBTOTAL" || plain == "AGGREGATE" || arguments.iter().any(calls_a_total)
        }
        Expr::Binary { left, right, .. } => calls_a_total(left) || calls_a_total(right),
        Expr::Unary { operand, .. } | Expr::Percent(operand) | Expr::Parenthesised(operand) => {
            calls_a_total(operand)
        }
        Expr::Array(rows) => rows.iter().flatten().any(calls_a_total),
        _ => false,
    }
}
