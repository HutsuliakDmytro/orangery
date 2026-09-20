//! Excel-compatible formulas: reading them, and one day working them out.
//!
//! A pure library. No files, no window, no Tauri — it is handed cells and
//! asked for values, which is what lets it be tested without a spreadsheet
//! around it and compiled to WASM for the web viewer
//! (`apps/sheets/docs/adr/0003-formula-engine.md`).
//!
//! What is here so far: text into tokens, tokens into a tree, and a tree into
//! a value against cells somebody else holds. The dependency graph and
//! recalculation come after, and each stage knows nothing about the next.

pub mod ast;
pub mod date;
pub mod engine;
pub mod eval;
pub mod fast;
pub mod functions;
pub mod graph;
pub mod lexer;
pub mod numfmt;
pub mod parser;
pub mod reference;
pub mod table;
pub mod value;

pub use ast::{Expr, Operator};
pub use date::{date_of, serial_of, DateSystem};
pub use engine::{Applied, Changed, Edit, Engine, Trace};
pub use eval::{evaluate, reference_of, Cells, Context, Rect, Standing};
pub use graph::{precedents_of, Area, Graph, Precedents, Recalculation};
pub use lexer::{lex, Token, TokenKind};
pub use parser::{parse, ParseError};
pub use reference::{Reference, ReferenceKind};
pub use table::Table;
pub use value::{Array, Error, Value};
