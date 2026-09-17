//! The native side every Orangery app has in common.
//!
//! None of this knows what is inside the file it is writing. A document and a
//! deck are both bytes that must reach the disk without a half-written file
//! ever existing, both want an autosave the app can recover from, and both
//! build their menu from whatever commands the frontend registered.
//!
//! What stays in an app: the Tauri builder itself, its plugins, and anything
//! about the format it holds.

pub mod diagnostics;
pub mod document;
mod error;
pub mod menu;

pub use error::AppError;
