//! Formula text into tokens.
//!
//! The awkward parts of a spreadsheet's grammar are all here rather than in
//! the parser, because they are about how things are *written*: a sheet name
//! can hold spaces if it is quoted, a string doubles its quotes to hold one, a
//! reference can be pinned with dollars, and an error value is a word that
//! starts with a hash and is not a comment.
//!
//! Two operators are written as punctuation nobody thinks of as an operator: a
//! space between two references is an intersection, and a comma between them
//! is a union. They are tokens here and are sorted out by the parser, which is
//! the only place that knows whether what came before was a reference.

use crate::ast::Structured;
use crate::reference::{column_index, Anchored, Reference, ReferenceKind};

#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    Number(f64),
    Text(String),
    /// `TRUE` and `FALSE`, which are values rather than names.
    Bool(bool),
    /// `#DIV/0!` and the rest: values of the language, not failures to parse.
    Error(String),
    Reference(Reference),
    /// A function about to be called, or a defined name, or a table.
    Name(String),
    /// A table's own way of naming a column: `Table1[Amount]`.
    Structured(Structured),
    Operator(String),
    OpenParen,
    CloseParen,
    OpenBrace,
    CloseBrace,
    Comma,
    Semicolon,
    /// A space where a space means something: between two references.
    Space,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    /// Where it started, for an error that has to point at something.
    pub at: usize,
}

const ERRORS: [&str; 9] = [
    "#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!", "#SPILL!", "#CALC!",
];

/// Every token of a formula, in the order it is written.
///
/// The leading `=` is not part of a formula here: a file stores `SUM(A1)` and
/// the bar shows `=SUM(A1)`, and taking it off at the door means nothing
/// further in has to wonder which it was given.
pub fn lex(input: &str) -> Result<Vec<Token>, String> {
    let text: Vec<char> = input.trim_start_matches('=').chars().collect();
    let mut tokens: Vec<Token> = Vec::new();
    let mut at = 0usize;

    while at < text.len() {
        let here = text[at];

        if here == ' ' || here == '\n' || here == '\r' || here == '\t' {
            // Kept, because a space between two references is an operator. The
            // parser drops the ones that are only spacing.
            while at < text.len() && matches!(text[at], ' ' | '\n' | '\r' | '\t') {
                at += 1;
            }
            tokens.push(Token {
                kind: TokenKind::Space,
                at,
            });
            continue;
        }

        let start = at;

        if here == '"' {
            let (value, next) = lex_string(&text, at)?;
            at = next;
            tokens.push(Token {
                kind: TokenKind::Text(value),
                at: start,
            });
            continue;
        }

        if here == '#' {
            match lex_error(&text, at) {
                Some((value, next)) => {
                    at = next;
                    tokens.push(Token {
                        kind: TokenKind::Error(value),
                        at: start,
                    });
                    continue;
                }
                // `#REF!` inside a name is the other thing a hash starts, and
                // `A#` is a spilled-range reference; neither is handled yet,
                // so an unknown hash is an error rather than a guess.
                None => return Err(format!("unknown error value at {start}")),
            }
        }

        // `2:5` is rows two to five, not two ranged with five: the colon only
        // ever joins references, so a number followed by one is a row.
        if here.is_ascii_digit() {
            if let Some((token, next)) = lex_rows(&text, at) {
                at = next;
                tokens.push(Token {
                    kind: token,
                    at: start,
                });
                continue;
            }
        }

        if here.is_ascii_digit()
            || (here == '.' && at + 1 < text.len() && text[at + 1].is_ascii_digit())
        {
            let (value, next) = lex_number(&text, at)?;
            at = next;
            tokens.push(Token {
                kind: TokenKind::Number(value),
                at: start,
            });
            continue;
        }

        // A bracket starts one of two things, and which it is depends on
        // what follows the closing one: a workbook somebody else has, or a
        // column of the table this formula is sitting in.
        if here == '[' {
            if let Some((token, next)) = lex_external(&text, at)? {
                at = next;
                tokens.push(Token {
                    kind: token,
                    at: start,
                });
                continue;
            }

            if let Some((token, next)) = lex_structured(&text, at, None)? {
                at = next;
                tokens.push(Token {
                    kind: token,
                    at: start,
                });
                continue;
            }
        }

        if let Some((token, next)) = lex_reference_or_name(&text, at)? {
            // A name with a bracket hard against it is a table: `Table1[Amount]`.
            if let TokenKind::Name(name) = &token {
                if text.get(next) == Some(&'[') {
                    if let Some((structured, after)) =
                        lex_structured(&text, next, Some(name.clone()))?
                    {
                        at = after;
                        tokens.push(Token {
                            kind: structured,
                            at: start,
                        });
                        continue;
                    }
                }
            }

            at = next;
            tokens.push(Token {
                kind: token,
                at: start,
            });
            continue;
        }

        let kind = match here {
            '@' => TokenKind::Operator("@".to_string()),
            '(' => TokenKind::OpenParen,
            ')' => TokenKind::CloseParen,
            '{' => TokenKind::OpenBrace,
            '}' => TokenKind::CloseBrace,
            ',' => TokenKind::Comma,
            ';' => TokenKind::Semicolon,
            _ => {
                let (operator, next) = lex_operator(&text, at)?;
                at = next;
                tokens.push(Token {
                    kind: TokenKind::Operator(operator),
                    at: start,
                });
                continue;
            }
        };

        at += 1;
        tokens.push(Token { kind, at: start });
    }

    Ok(tokens)
}

/// `2:5`, which is a reference to whole rows written without any letters.
fn lex_rows(text: &[char], from: usize) -> Option<(TokenKind, usize)> {
    let mut at = from;
    while at < text.len() && text[at].is_ascii_digit() {
        at += 1;
    }

    if at >= text.len() || text[at] != ':' {
        return None;
    }

    let (second, next) = lex_anchored_cell(text, at + 1)?;
    let first: i64 = text[from..at]
        .iter()
        .collect::<String>()
        .parse::<i64>()
        .ok()?
        - 1;

    match second {
        Part::Row(to) => Some((
            TokenKind::Reference(Reference {
                sheet: None,
                kind: ReferenceKind::Rows {
                    from: Anchored::relative(first),
                    to,
                },
            }),
            next,
        )),
        _ => None,
    }
}

/// A quoted string, where two quotes in a row are one quote in the value.
fn lex_string(text: &[char], from: usize) -> Result<(String, usize), String> {
    let mut at = from + 1;
    let mut value = String::new();

    while at < text.len() {
        if text[at] == '"' {
            if at + 1 < text.len() && text[at + 1] == '"' {
                value.push('"');
                at += 2;
                continue;
            }
            return Ok((value, at + 1));
        }

        value.push(text[at]);
        at += 1;
    }

    Err(format!("a string that never ends, from {from}"))
}

fn lex_error(text: &[char], from: usize) -> Option<(String, usize)> {
    let rest: String = text[from..].iter().collect();
    let upper = rest.to_ascii_uppercase();

    ERRORS
        .iter()
        .find(|one| upper.starts_with(*one))
        .map(|one| ((*one).to_string(), from + one.len()))
}

/// A number, with the exponent Excel allows and the decimal point it insists on.
fn lex_number(text: &[char], from: usize) -> Result<(f64, usize), String> {
    let mut at = from;
    let mut seen_point = false;

    while at < text.len() {
        let here = text[at];
        if here.is_ascii_digit() {
            at += 1;
        } else if here == '.' && !seen_point {
            seen_point = true;
            at += 1;
        } else if (here == 'e' || here == 'E')
            && at + 1 < text.len()
            && (text[at + 1].is_ascii_digit()
                || ((text[at + 1] == '+' || text[at + 1] == '-')
                    && at + 2 < text.len()
                    && text[at + 2].is_ascii_digit()))
        {
            at += 2;
            while at < text.len() && text[at].is_ascii_digit() {
                at += 1;
            }
            break;
        } else {
            break;
        }
    }

    let written: String = text[from..at].iter().collect();
    written
        .parse::<f64>()
        .map(|value| (value, at))
        .map_err(|_| format!("not a number at {from}: {written}"))
}

fn lex_operator(text: &[char], from: usize) -> Result<(String, usize), String> {
    // The two-character comparisons first, or `<=` would be read as `<`.
    if from + 1 < text.len() {
        let pair: String = text[from..from + 2].iter().collect();
        if pair == "<=" || pair == ">=" || pair == "<>" {
            return Ok((pair, from + 2));
        }
    }

    let here = text[from];
    if matches!(
        here,
        '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<' | '>' | '%' | ':'
    ) {
        return Ok((here.to_string(), from + 1));
    }

    Err(format!("{here} is not an operator, at {from}"))
}

/// A word: a reference, a sheet-qualified one, a function name, a name.
fn lex_reference_or_name(text: &[char], from: usize) -> Result<Option<(TokenKind, usize)>, String> {
    let here = text[from];
    if !(here.is_alphabetic() || here == '_' || here == '$' || here == '\'' || here == '\\') {
        return Ok(None);
    }

    let (sheet, after_sheet) = lex_sheet(text, from)?;

    // A sheet name and then something that is not a reference is a mistake
    // worth naming: `Sheet1!` on its own says nothing.
    if let Some((kind, next)) = lex_reference_body(text, after_sheet, sheet.clone()) {
        // `LOG10(` is the function, not the cell in column LOG: a bracket
        // straight after it settles an ambiguity the spelling cannot.
        if !opens_a_call(text, next) {
            return Ok(Some((kind, next)));
        }
    }

    if sheet.is_some() {
        return Err(format!("a sheet name with nothing after it, at {from}"));
    }

    let (word, next) = lex_word(text, from);
    if word.is_empty() {
        return Ok(None);
    }

    let upper = word.to_ascii_uppercase();
    // `TRUE` is a value and `TRUE()` is a function, and they are the same four
    // letters: the bracket is the only thing that tells them apart.
    if !opens_a_call(text, next) {
        if upper == "TRUE" {
            return Ok(Some((TokenKind::Bool(true), next)));
        }
        if upper == "FALSE" {
            return Ok(Some((TokenKind::Bool(false), next)));
        }
    }

    Ok(Some((TokenKind::Name(word), next)))
}

/// Whether what follows is a bracket, which makes whatever came before a call.
fn opens_a_call(text: &[char], from: usize) -> bool {
    text.get(from) == Some(&'(')
}

/// `Sheet1!`, `'Two words'!`, `Sheet1:Sheet3!` — the part before the cells.
fn lex_sheet(text: &[char], from: usize) -> Result<(Option<(String, String)>, usize), String> {
    let mut at = from;

    let (first, after_first) = if text[at] == '\'' {
        let (name, next) = lex_quoted_sheet(text, at)?;
        (name, next)
    } else {
        let (name, next) = lex_sheet_word(text, at);
        if name.is_empty() {
            return Ok((None, from));
        }
        (name, next)
    };

    at = after_first;

    // `Sheet1:Sheet3!A1`, which is one reference across three sheets.
    let mut last = first.clone();
    if at < text.len() && text[at] == ':' {
        let after_colon = at + 1;
        let (second, next) = if after_colon < text.len() && text[after_colon] == '\'' {
            lex_quoted_sheet(text, after_colon)?
        } else {
            lex_sheet_word(text, after_colon)
        };

        if !second.is_empty() && next < text.len() && text[next] == '!' {
            last = second;
            at = next;
        }
    }

    if at < text.len() && text[at] == '!' {
        return Ok((Some((first, last)), at + 1));
    }

    Ok((None, from))
}

fn lex_quoted_sheet(text: &[char], from: usize) -> Result<(String, usize), String> {
    let mut at = from + 1;
    let mut name = String::new();

    while at < text.len() {
        if text[at] == '\'' {
            // Two quotes are one, the same rule strings follow.
            if at + 1 < text.len() && text[at + 1] == '\'' {
                name.push('\'');
                at += 2;
                continue;
            }
            return Ok((name, at + 1));
        }
        name.push(text[at]);
        at += 1;
    }

    Err(format!("a sheet name that never ends, from {from}"))
}

fn lex_sheet_word(text: &[char], from: usize) -> (String, usize) {
    let mut at = from;
    while at < text.len() && (text[at].is_alphanumeric() || text[at] == '_' || text[at] == '.') {
        at += 1;
    }

    (text[from..at].iter().collect(), at)
}

fn lex_word(text: &[char], from: usize) -> (String, usize) {
    let mut at = from;
    while at < text.len()
        && (text[at].is_alphanumeric() || text[at] == '_' || text[at] == '.' || text[at] == '\\')
    {
        at += 1;
    }

    (text[from..at].iter().collect(), at)
}

/// The cells part of a reference: `A1`, `$B$2:$C$9`, `A:A`, `3:5`.
fn lex_reference_body(
    text: &[char],
    from: usize,
    sheet: Option<(String, String)>,
) -> Option<(TokenKind, usize)> {
    let (first, after_first) = lex_anchored_cell(text, from)?;

    if after_first < text.len() && text[after_first] == ':' {
        if let Some((second, after_second)) = lex_anchored_cell(text, after_first + 1) {
            let kind = match (first, second) {
                (Part::Cell(row, column), Part::Cell(to_row, to_column)) => ReferenceKind::Range {
                    from: (row, column),
                    to: (to_row, to_column),
                },
                (Part::Column(from_column), Part::Column(to_column)) => ReferenceKind::Columns {
                    from: from_column,
                    to: to_column,
                },
                (Part::Row(from_row), Part::Row(to_row)) => ReferenceKind::Rows {
                    from: from_row,
                    to: to_row,
                },
                // `A1:B` is not a reference, and reading it as one would be
                // inventing what the person meant.
                _ => return None,
            };

            return Some((
                TokenKind::Reference(Reference { sheet, kind }),
                after_second,
            ));
        }
    }

    match first {
        Part::Cell(row, column) => Some((
            TokenKind::Reference(Reference {
                sheet,
                kind: ReferenceKind::Cell { row, column },
            }),
            after_first,
        )),
        // A single `A` or `1` is a name or a number, not a reference.
        _ => None,
    }
}

enum Part {
    Cell(Anchored, Anchored),
    Column(Anchored),
    Row(Anchored),
}

fn lex_anchored_cell(text: &[char], from: usize) -> Option<(Part, usize)> {
    let mut at = from;

    let column_absolute = at < text.len() && text[at] == '$';
    if column_absolute {
        at += 1;
    }

    let letters_from = at;
    while at < text.len() && text[at].is_ascii_alphabetic() && at - letters_from < 3 {
        at += 1;
    }
    let letters: String = text[letters_from..at].iter().collect();

    let row_absolute = at < text.len() && text[at] == '$';
    if row_absolute {
        at += 1;
    }

    let digits_from = at;
    while at < text.len() && text[at].is_ascii_digit() {
        at += 1;
    }
    let digits: String = text[digits_from..at].iter().collect();

    // Anything following that could be part of a name means this was a name:
    // `A1B` is not a cell, and `Sheet1` is not `S` and `1`.
    if at < text.len() && (text[at].is_alphanumeric() || text[at] == '_' || text[at] == '.') {
        return None;
    }

    if !letters.is_empty() && !digits.is_empty() {
        let column = column_index(&letters)?;
        let row: i64 = digits.parse::<i64>().ok()? - 1;
        return Some((
            Part::Cell(
                Anchored {
                    index: row,
                    absolute: row_absolute,
                },
                Anchored {
                    index: column,
                    absolute: column_absolute,
                },
            ),
            at,
        ));
    }

    if !letters.is_empty() && digits.is_empty() && !row_absolute {
        let column = column_index(&letters)?;
        return Some((
            Part::Column(Anchored {
                index: column,
                absolute: column_absolute,
            }),
            at,
        ));
    }

    if letters.is_empty() && !digits.is_empty() && !column_absolute {
        let row: i64 = digits.parse::<i64>().ok()? - 1;
        return Some((
            Part::Row(Anchored {
                index: row,
                absolute: row_absolute,
            }),
            at,
        ));
    }

    None
}

/// A structured reference: `Table1[Amount]`, `[@Amount]`, `Table1[[#Totals],[Amount]]`.
///
/// Lexed whole rather than as brackets and words, because inside them the
/// language is a different one: `#` starts a part rather than an error value,
/// `@` means this row, and a column called `Amount 2024` is one name with a
/// space in it.
fn lex_structured(
    text: &[char],
    from: usize,
    table: Option<String>,
) -> Result<Option<(TokenKind, usize)>, String> {
    if text.get(from) != Some(&'[') {
        return Ok(None);
    }

    let mut depth = 0usize;
    let mut at = from;
    while at < text.len() {
        match text[at] {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        at += 1;
    }

    if depth != 0 {
        return Err(format!("a table reference that never closes, from {from}"));
    }

    let inside: String = text[from + 1..at].iter().collect();
    Ok(Some((
        TokenKind::Structured(read_structured(&inside, table)),
        at + 1,
    )))
}

/// What is written between the brackets, read into its pieces.
fn read_structured(inside: &str, table: Option<String>) -> Structured {
    let mut found = Structured {
        table,
        ..Structured::default()
    };

    for piece in top_level_pieces(inside) {
        let piece = piece.trim();
        let piece = piece
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
            .unwrap_or(piece);

        if let Some(part) = piece.strip_prefix('#') {
            // `#This Row` is the older spelling of `@`, and means the same.
            if part.eq_ignore_ascii_case("This Row") {
                found.this_row = true;
            } else {
                found.parts.push(part.to_string());
            }
            continue;
        }

        if let Some(column) = piece.strip_prefix('@') {
            found.this_row = true;
            if !column.is_empty() {
                found.columns.push(unescaped(column));
            }
            continue;
        }

        if !piece.is_empty() {
            found.columns.push(unescaped(piece));
        }
    }

    found
}

/// The pieces of a structured reference, split on the commas and colons that
/// are not inside a nested bracket.
fn top_level_pieces(inside: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut piece = String::new();
    let mut depth = 0usize;

    for letter in inside.chars() {
        match letter {
            '[' => {
                depth += 1;
                piece.push(letter);
            }
            ']' => {
                depth = depth.saturating_sub(1);
                piece.push(letter);
            }
            ',' | ':' if depth == 0 => {
                pieces.push(std::mem::take(&mut piece));
            }
            _ => piece.push(letter),
        }
    }

    pieces.push(piece);
    pieces
}

/// A column name with the escapes Excel uses inside brackets taken off.
///
/// A column really called `Amount [net]` is written `Amount '[net']`, because
/// the brackets are the language's own punctuation.
fn unescaped(name: &str) -> String {
    let mut out = String::new();
    let mut letters = name.chars().peekable();

    while let Some(letter) = letters.next() {
        if letter == '\'' {
            if let Some(next) = letters.next() {
                out.push(next);
                continue;
            }
        }
        out.push(letter);
    }

    out
}

/// `[Book.xlsx]Sheet1!A1` — a reference into a workbook somebody else has.
///
/// The book and the sheet are kept as one name, exactly as written. Nothing
/// here can open that file, and a formula that names it is worked out by
/// nobody: what the cell shows is the number the file was saved with
/// (`graph.rs`, `Precedents::external`).
fn lex_external(text: &[char], from: usize) -> Result<Option<(TokenKind, usize)>, String> {
    if text.get(from) != Some(&'[') {
        return Ok(None);
    }

    let Some(close) = (from + 1..text.len()).find(|at| text[*at] == ']') else {
        return Ok(None);
    };

    let (sheet, after_sheet) = lex_sheet_word(text, close + 1);
    if text.get(after_sheet) != Some(&'!') {
        return Ok(None);
    }

    let book: String = text[from..=close].iter().collect();
    let whole = format!("{book}{sheet}");

    Ok(lex_reference_body(
        text,
        after_sheet + 1,
        Some((whole.clone(), whole)),
    ))
}
