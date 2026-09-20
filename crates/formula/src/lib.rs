//! Excel-compatible formulas: reading them, and one day working them out.
//!
//! A pure library. No files, no window, no Tauri — it is handed cells and
//! asked for values, which is what lets it be tested without a spreadsheet
//! around it and compiled to WASM for the web viewer
//! (`apps/sheets/docs/adr/0003-formula-engine.md`).
//!
//! What is here so far is the front of the pipeline: text into tokens, tokens
//! into a tree. Evaluation, the dependency graph and recalculation come after,
//! and each is a stage that knows nothing about the next.

pub mod ast;
pub mod lexer;
pub mod parser;
pub mod reference;

pub use ast::{Expr, Operator};
pub use lexer::{lex, Token, TokenKind};
pub use parser::{parse, ParseError};
pub use reference::{Reference, ReferenceKind};
