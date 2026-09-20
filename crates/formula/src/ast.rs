//! What a formula says, once it has been read.
//!
//! A tree of expressions and nothing else: no values, no cells, no knowledge
//! of what `SUM` does. The evaluator walks this; the parser builds it; neither
//! knows about the other.

use crate::reference::Reference;

/// The operators of the language, in the spelling Excel uses.
///
/// Two of them are written as punctuation: a space between references is an
/// intersection and a comma is a union. They are operators all the same, and
/// naming them here is what stops the parser from having to explain itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operator {
    Add,
    Subtract,
    Multiply,
    Divide,
    Power,
    /// `&`, which joins text.
    Concat,
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
    /// `:` — the range between two references.
    Range,
    /// A space — the cells two references have in common.
    Intersect,
    /// A comma — both references at once.
    Union,
}

impl Operator {
    /// How tightly it binds. Excel's own order, which is not C's.
    pub fn precedence(self) -> u8 {
        match self {
            Operator::Union => 1,
            Operator::Intersect => 2,
            Operator::Range => 3,
            Operator::Equal
            | Operator::NotEqual
            | Operator::Less
            | Operator::LessOrEqual
            | Operator::Greater
            | Operator::GreaterOrEqual => 4,
            Operator::Concat => 5,
            Operator::Add | Operator::Subtract => 6,
            Operator::Multiply | Operator::Divide => 7,
            Operator::Power => 8,
        }
    }

    /// Whether `a op b op c` means `(a op b) op c`.
    ///
    /// Everything does except the power operator, which Excel groups to the
    /// left as well — `2^3^2` is 64 there and 512 in mathematics, and being
    /// right about Excel is the bar.
    pub fn left_associative(self) -> bool {
        true
    }
}

/// A reference written in a table's own words: `Table1[Amount]`.
///
/// What Excel writes as soon as a range is made into a table, and what
/// somebody sees when they click a column of one. It survives rows being
/// inserted, which an `A1` reference does not — that is the whole point of
/// it, and the reason a workbook that uses tables uses these everywhere.
///
/// The parts are kept as they were written rather than resolved here.
/// Where `Table1[Amount]` actually is depends on where the table is, which
/// is a fact about the workbook and not about the formula (`Cells::area_of`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Structured {
    /// The table named, or nothing when the formula is inside the table it
    /// is talking about.
    pub table: Option<String>,
    /// `#Headers`, `#Totals`, `#Data`, `#All` — without the hash.
    pub parts: Vec<String>,
    /// The columns named: one, or two where a span was written.
    pub columns: Vec<String>,
    /// `[@Amount]` — the part of the column on the row this formula is on.
    pub this_row: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    /// An error written into the formula, which is a value like any other.
    Error(String),
    Reference(Reference),
    /// A table's own way of naming a column: `Table1[Amount]`.
    Structured(Structured),
    /// `@` — the one value of a range that lines up with this formula.
    ///
    /// Excel writes it in front of anything that could spill but should not,
    /// which is how a workbook written in 365 still opens in 2013 and means
    /// the same thing.
    Implicit(Box<Expr>),
    /// A defined name, or a table, or anything else spelled as a word.
    Name(String),
    Call {
        name: String,
        arguments: Vec<Expr>,
    },
    Binary {
        operator: Operator,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    /// `-A1` and `+A1`, which are not the same as subtracting from nothing.
    Unary {
        negative: bool,
        operand: Box<Expr>,
    },
    /// `50%`, which divides what comes before it by a hundred.
    Percent(Box<Expr>),
    /// `{1,2;3,4}` — rows of values written into the formula itself.
    Array(Vec<Vec<Expr>>),
    /// Brackets, kept because a formula is written back as it was read.
    Parenthesised(Box<Expr>),
    /// An argument left out: `IF(A1,,2)`, where the middle one is empty.
    Blank,
}
