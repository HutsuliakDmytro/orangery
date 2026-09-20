//! The number-format language, against the table it is judged by.
//!
//! The rows are `tests/fixtures/number-formats.tsv`, which
//! `packages/numfmt` is tested against as well. There are two
//! implementations of this language — one in the window, which formats every
//! visible cell while the grid draws it, and one here, which `TEXT` uses in
//! the middle of a recalculation — and neither can call the other without
//! crossing a process boundary per cell. Two implementations of one language
//! drift unless something holds them together; this is the something.

use std::path::PathBuf;

use formula::date::DateSystem;
use formula::numfmt::{format_value, Shown};

/// A row of the table: what was held, how it was to be shown, and what Excel
/// shows for the two of them.
struct Row {
    group: String,
    value: String,
    code: String,
    expected: String,
}

fn table() -> Vec<Row> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/number-formats.tsv");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("the table at {} could not be read: {error}", path.display())
    });

    let mut rows = Vec::new();
    let mut group = "ungrouped".to_string();

    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Some(said) = line.strip_prefix('#') {
            // A heading is a comment with one phrase after the hash; the
            // block of explanation at the top has tabs in it.
            let said = said.trim();
            if !said.is_empty() && !said.contains('\t') {
                group = said.to_string();
            }
            continue;
        }

        let mut fields = line.split('\t');
        let (Some(value), Some(code)) = (fields.next(), fields.next()) else {
            continue;
        };

        rows.push(Row {
            group: group.clone(),
            value: value.to_string(),
            code: code.to_string(),
            expected: fields.next().unwrap_or("").to_string(),
        });
    }

    rows
}

#[test]
fn every_row_of_the_shared_table() {
    let rows = table();
    // A path that has moved would otherwise make this file pass by testing
    // nothing at all.
    assert!(rows.len() > 90, "the table has only {} rows", rows.len());

    let mut wrong = Vec::new();

    for row in &rows {
        let shown = match row
            .value
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
        {
            Some(text) => format_value(Shown::Text(text), &row.code, DateSystem::Excel1900),
            None => {
                let number: f64 = row
                    .value
                    .parse()
                    .unwrap_or_else(|_| panic!("{} is not a value the table can hold", row.value));
                format_value(Shown::Number(number), &row.code, DateSystem::Excel1900)
            }
        };

        if shown != row.expected {
            wrong.push(format!(
                "{}: {} through {} is {:?}, not {:?}",
                row.group, row.value, row.code, shown, row.expected
            ));
        }
    }

    assert!(
        wrong.is_empty(),
        "{} of {} rows disagree:\n{}",
        wrong.len(),
        rows.len(),
        wrong.join("\n")
    );
}
