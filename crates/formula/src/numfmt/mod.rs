//! What a cell shows for what it holds.
//!
//! A workbook stores 45292 and shows "1 Jan 2024"; it stores 0.15 and shows
//! "15%". The number is the truth and the format is the picture, and this is
//! the picture.
//!
//! **There are two of these.** `packages/numfmt` reads the same language in
//! TypeScript, because the grid formats every visible cell while it draws it
//! — thirty thousand of them a frame — and a message to Rust per cell would
//! be a message to Rust per cell. This one exists because `TEXT` is a
//! function: it formats a number in the middle of a recalculation, where
//! there is no window to ask.
//!
//! Two implementations of one language will drift unless something holds them
//! together, so something does: `tests/fixtures/number-formats.tsv` is a
//! table of values, codes and what Excel shows for them, and both are tested
//! against it. A row added there is a row both have to pass.

pub mod format;
pub mod parse;

pub use format::{format_general, format_value, Shown};
pub use parse::{parse_format, Kind, NumberFormat, Section, Token};
