//! What a formula points at.
//!
//! A reference is the one thing in a formula that is not a value: it names
//! cells, and what it means depends on where the formula is. Keeping the `$`
//! is what makes that work — a pinned row does not move when the formula is
//! copied, and a reader that dropped the dollar would be a reader that broke
//! every copied formula in the file.

/// Which half of a reference is pinned, said as the file says it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Anchored {
    pub index: i64,
    /// `$` before it: the reference stays where it is when copied.
    pub absolute: bool,
}

impl Anchored {
    pub fn relative(index: i64) -> Self {
        Self {
            index,
            absolute: false,
        }
    }

    pub fn absolute(index: i64) -> Self {
        Self {
            index,
            absolute: true,
        }
    }
}

/// The shapes a reference comes in.
///
/// A whole row or column is not a range with a huge end: Excel writes `A:A`
/// and means "this column, however far the sheet reaches", and treating it as
/// `A1:A1048576` would be right about the cells and wrong about what happens
/// when the sheet grows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReferenceKind {
    Cell {
        row: Anchored,
        column: Anchored,
    },
    Range {
        from: (Anchored, Anchored),
        to: (Anchored, Anchored),
    },
    Columns {
        from: Anchored,
        to: Anchored,
    },
    Rows {
        from: Anchored,
        to: Anchored,
    },
}

/// A reference, with the sheets it reaches across.
///
/// `Sheet1:Sheet3!A1` is one reference over three sheets — Excel calls it 3-D
/// — so the sheet part is a span rather than a name. Both ends are the same
/// name for the ordinary case, and neither is set for a reference on the
/// sheet the formula is already on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub sheet: Option<(String, String)>,
    pub kind: ReferenceKind,
}

impl Reference {
    /// The one everybody means: a cell on the sheet the formula is on.
    pub fn cell(row: i64, column: i64) -> Self {
        Self {
            sheet: None,
            kind: ReferenceKind::Cell {
                row: Anchored::relative(row),
                column: Anchored::relative(column),
            },
        }
    }
}

/// `A` is 0, `Z` is 25, `AA` is 26 — the letters a spreadsheet names columns with.
pub fn column_index(letters: &str) -> Option<i64> {
    if letters.is_empty() || letters.len() > 3 {
        return None;
    }

    let mut index: i64 = 0;
    for letter in letters.chars() {
        let value = match letter {
            'A'..='Z' => letter as i64 - 'A' as i64,
            'a'..='z' => letter as i64 - 'a' as i64,
            _ => return None,
        };
        index = index * 26 + value + 1;
    }

    Some(index - 1)
}

/// The same backwards, for writing a reference out again.
pub fn column_letters(index: i64) -> String {
    let mut letters = Vec::new();
    let mut left = index + 1;

    while left > 0 {
        let step = (left - 1) % 26;
        letters.push((b'A' + step as u8) as char);
        left = (left - 1) / 26;
    }

    letters.iter().rev().collect()
}
