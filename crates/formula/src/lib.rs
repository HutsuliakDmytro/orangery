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
pub mod engine;
pub mod eval;
pub mod functions;
pub mod graph;
pub mod lexer;
pub mod parser;
pub mod reference;
pub mod value;

pub use ast::{Expr, Operator};
pub use engine::{Changed, Engine};
pub use eval::{evaluate, Cells, Context};
pub use graph::{precedents_of, Graph, Precedents, Recalculation};
pub use lexer::{lex, Token, TokenKind};
pub use parser::{parse, ParseError};
pub use reference::{Reference, ReferenceKind};
pub use value::{Array, Error, Value};
