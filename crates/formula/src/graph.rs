//! What a formula depends on, and what depends on it.
//!
//! A spreadsheet recalculates in an order it has to work out for itself: `C1`
//! holds `=B1*2`, `B1` holds `=A1+1`, and typing into `A1` has to reach both
//! of them, in that order. The graph is how that order is known.
//!
//! Two kinds of edge, because a formula can name a cell or a rectangle.
//! A cell edge is a lookup; a range edge has to be asked whether it contains
//! the cell that changed. That second kind is a scan today and wants an
//! interval tree when the sheets are large (`PLAN.md`, phase 3.1) — the shape
//! of the answer does not change, only how quickly it is found.

use std::collections::{HashMap, HashSet};

use crate::ast::Expr;
use crate::reference::{Reference, ReferenceKind};

/// A cell, named the way the engine names one.
pub type CellId = (String, i64, i64);

/// A rectangle of cells on one sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Area {
    pub sheet: String,
    pub top: i64,
    pub bottom: i64,
    pub left: i64,
    pub right: i64,
}

impl Area {
    pub fn contains(&self, cell: &CellId) -> bool {
        cell.0 == self.sheet
            && cell.1 >= self.top
            && cell.1 <= self.bottom
            && cell.2 >= self.left
            && cell.2 <= self.right
    }
}

/// What one formula reaches: the cells it names and the rectangles it covers.
#[derive(Debug, Default, Clone)]
pub struct Precedents {
    pub cells: Vec<CellId>,
    pub areas: Vec<Area>,
    /// Whether it names something whose extent is not known here, like `A:A`.
    pub whole_columns: bool,
}

/// Everything a formula depends on, worked out from its tree.
///
/// The sheet a reference has no name for is the one the formula is on, which
/// is why the tree alone is not enough to answer this.
pub fn precedents_of(expression: &Expr, sheet: &str) -> Precedents {
    let mut found = Precedents::default();
    walk(expression, sheet, &mut found);
    found
}

fn walk(expression: &Expr, sheet: &str, found: &mut Precedents) {
    match expression {
        Expr::Reference(reference) => add(reference, sheet, found),

        Expr::Binary { left, right, .. } => {
            walk(left, sheet, found);
            walk(right, sheet, found);
        }
        Expr::Unary { operand, .. } | Expr::Percent(operand) | Expr::Parenthesised(operand) => {
            walk(operand, sheet, found)
        }
        Expr::Call { arguments, .. } => {
            for argument in arguments {
                walk(argument, sheet, found);
            }
        }
        Expr::Array(rows) => {
            for row in rows {
                for value in row {
                    walk(value, sheet, found);
                }
            }
        }

        _ => {}
    }
}

fn add(reference: &Reference, sheet: &str, found: &mut Precedents) {
    let on = reference
        .sheet
        .as_ref()
        .map_or_else(|| sheet.to_string(), |(first, _)| first.clone());

    match &reference.kind {
        ReferenceKind::Cell { row, column } => found.cells.push((on, row.index, column.index)),

        ReferenceKind::Range { from, to } => found.areas.push(Area {
            sheet: on,
            top: from.0.index.min(to.0.index),
            bottom: from.0.index.max(to.0.index),
            left: from.1.index.min(to.1.index),
            right: from.1.index.max(to.1.index),
        }),

        // A whole column has no bottom until somebody says how far the sheet
        // reaches, so it is marked rather than measured: anything on that
        // sheet may be a precedent.
        ReferenceKind::Columns { from, to } => {
            found.whole_columns = true;
            found.areas.push(Area {
                sheet: on,
                top: 0,
                bottom: i64::MAX,
                left: from.index.min(to.index),
                right: from.index.max(to.index),
            });
        }
        ReferenceKind::Rows { from, to } => {
            found.whole_columns = true;
            found.areas.push(Area {
                sheet: on,
                top: from.index.min(to.index),
                bottom: from.index.max(to.index),
                left: 0,
                right: i64::MAX,
            });
        }
    }
}

/// Which formula depends on what, and the other way round.
#[derive(Debug, Default)]
pub struct Graph {
    /// For each cell, the formulas that name it directly.
    dependents: HashMap<CellId, HashSet<CellId>>,
    /// For each formula, the rectangles it covers — asked by intersection.
    areas: Vec<(Area, CellId)>,
    /// What each formula reaches, so it can be taken out again cleanly.
    precedents: HashMap<CellId, Precedents>,
}

impl Graph {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records what one formula depends on, replacing whatever it depended on
    /// before — which is what editing a formula amounts to.
    pub fn set(&mut self, cell: CellId, precedents: Precedents) {
        self.remove(&cell);

        for precedent in &precedents.cells {
            self.dependents
                .entry(precedent.clone())
                .or_default()
                .insert(cell.clone());
        }
        for area in &precedents.areas {
            self.areas.push((area.clone(), cell.clone()));
        }

        self.precedents.insert(cell, precedents);
    }

    /// Forgets a formula: the cell holds a value now, or nothing.
    pub fn remove(&mut self, cell: &CellId) {
        if let Some(before) = self.precedents.remove(cell) {
            for precedent in &before.cells {
                if let Some(set) = self.dependents.get_mut(precedent) {
                    set.remove(cell);
                }
            }
        }

        self.areas.retain(|(_, dependent)| dependent != cell);
    }

    /// The formulas that name a cell, directly.
    pub fn dependents_of(&self, cell: &CellId) -> Vec<CellId> {
        let mut found: HashSet<CellId> = self.dependents.get(cell).cloned().unwrap_or_default();

        for (area, dependent) in &self.areas {
            if area.contains(cell) {
                found.insert(dependent.clone());
            }
        }

        found.into_iter().collect()
    }

    /// What a formula reaches, for anything that needs to look the other way.
    pub fn precedents_of(&self, cell: &CellId) -> Option<&Precedents> {
        self.precedents.get(cell)
    }

    /// Every formula the graph knows about.
    pub fn formulas(&self) -> impl Iterator<Item = &CellId> {
        self.precedents.keys()
    }

    /// Everything that has to be worked out again once these cells change,
    /// in an order where nothing is worked out before what it depends on.
    ///
    /// The cells in a cycle come back separately rather than being left out
    /// silently: Excel warns about a circular reference and sets those cells
    /// to nought, and the warning is the caller's to show.
    pub fn order_from(&self, changed: &[CellId]) -> Recalculation {
        let mut affected: HashSet<CellId> = HashSet::new();
        let mut queue: Vec<CellId> = changed.to_vec();

        // A formula that has just been written is one of the things that has
        // to be worked out: it is not its own dependant, and leaving it out
        // would show a new formula as blank until something near it moved.
        for cell in changed {
            if self.precedents.contains_key(cell) {
                affected.insert(cell.clone());
            }
        }

        while let Some(cell) = queue.pop() {
            for dependent in self.dependents_of(&cell) {
                if affected.insert(dependent.clone()) {
                    queue.push(dependent);
                }
            }
        }

        // Kahn's algorithm over the affected set: a formula is ready when
        // everything it depends on inside the set has been done.
        let mut waiting: HashMap<CellId, usize> = HashMap::new();
        for cell in &affected {
            let count = self
                .precedents_of(cell)
                .map(|precedents| self.inside(precedents, &affected))
                .unwrap_or(0);
            waiting.insert(cell.clone(), count);
        }

        let mut ready: Vec<CellId> = waiting
            .iter()
            .filter(|(_, count)| **count == 0)
            .map(|(cell, _)| cell.clone())
            .collect();
        ready.sort();

        let mut order: Vec<CellId> = Vec::new();

        while let Some(cell) = ready.pop() {
            order.push(cell.clone());

            let mut freed: Vec<CellId> = Vec::new();
            for dependent in self.dependents_of(&cell) {
                if let Some(count) = waiting.get_mut(&dependent) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        freed.push(dependent);
                    }
                }
            }

            freed.sort();
            ready.extend(freed);
        }

        let done: HashSet<CellId> = order.iter().cloned().collect();
        let mut circular: Vec<CellId> = affected
            .into_iter()
            .filter(|cell| !done.contains(cell))
            .collect();
        circular.sort();

        Recalculation { order, circular }
    }

    /// How many of a formula's precedents are themselves being recalculated.
    fn inside(&self, precedents: &Precedents, affected: &HashSet<CellId>) -> usize {
        let mut count = 0;

        for cell in &precedents.cells {
            if affected.contains(cell) {
                count += 1;
            }
        }

        for area in &precedents.areas {
            for cell in affected {
                if area.contains(cell) {
                    count += 1;
                }
            }
        }

        count
    }
}

/// What a change comes to: an order to work in, and what could not be ordered.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Recalculation {
    pub order: Vec<CellId>,
    /// The cells that depend on themselves, round however long a loop.
    pub circular: Vec<CellId>,
}
