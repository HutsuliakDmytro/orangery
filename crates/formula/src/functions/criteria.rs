//! Reading a criterion: the small sentences people write into `COUNTIF`.
//!
//! `">5"`, `"<>x"`, `"north*"`. The operator is written into the text rather
//! than passed beside it, which is why this reads a value apart rather than
//! being handed two numbers — and why the wildcards live here too.
//!
//! Two rules in it are worth the words, because both decide what a column
//! totals to. A comparison is between two of a kind: a word in the column is
//! not "greater than 5", although the kinds do have an order and using it
//! here would match every word there is. And an empty cell answers only the
//! criterion that asks for an empty cell — otherwise `COUNTIF(A:A,"<5")`
//! would count the million cells that are not there, which is the shape
//! people actually write.

use crate::ast::Expr;
use crate::eval::Context;
use crate::value::{compare, Array, Error, Value};

/// What a criterion says, once it has been read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Test {
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
}

/// Whether a value answers a criterion.
///
/// A criterion is a value or a little sentence: `">5"`, `"<>x"`, `"app*"`.
/// The operator is written into the text, which is why this reads a value
/// rather than being handed two numbers — and text criteria take the
/// wildcards, because `COUNTIF(A:A,"north*")` is what people write.
pub fn matches(value: &Value, criterion: &Value) -> Result<bool, Error> {
    use std::cmp::Ordering;

    let (test, against) = match criterion {
        Value::Text(text) => split_criterion(text),
        other => (Test::Equal, other.clone()),
    };

    // An empty cell answers only the criterion that asks for one. Every other
    // criterion passes it over, which is why `COUNTIF(A:A,"<5")` counts the
    // numbers in the column rather than the million cells that are not there
    // — and why `COUNTIF(A:A,"<>")` is a count of what is filled in.
    if matches!(value, Value::Blank) {
        return Ok(test == Test::Equal && against == Value::Text(String::new()));
    }

    // A pattern is only a pattern for equality: `">a*"` is a comparison
    // against the text `a*`, which is what Excel does with it.
    if let Value::Text(pattern) = &against {
        if matches!(test, Test::Equal | Test::NotEqual) && pattern.contains(['*', '?']) {
            let text = match value {
                Value::Text(text) => text.clone(),
                Value::Blank => String::new(),
                other => other.to_text().unwrap_or_default(),
            };

            let same = glob(pattern, &text);
            return Ok(if test == Test::Equal { same } else { !same });
        }
    }

    // A comparison is between two of a kind: a word in the column is not
    // "greater than 5", and a number is not after "a" — though the kinds do
    // have an order, which is what makes sorting work and would make every
    // word in a column match `">5"` if it were used here. Equality needs no
    // such guard: values of different kinds are simply not equal.
    if !matches!(test, Test::Equal | Test::NotEqual) && !alike(value, &against) {
        return Ok(false);
    }

    let order = match compare(value, &against) {
        Ok(order) => order,
        // A comparison that cannot be made is a row that does not match,
        // rather than a total that fails.
        Err(_) => return Ok(false),
    };

    Ok(match test {
        Test::Equal => order == Ordering::Equal,
        Test::NotEqual => order != Ordering::Equal,
        Test::Less => order == Ordering::Less,
        Test::LessOrEqual => order != Ordering::Greater,
        Test::Greater => order == Ordering::Greater,
        Test::GreaterOrEqual => order != Ordering::Less,
    })
}

/// Whether two values are of a kind that can be put in order against
/// each other.
fn alike(left: &Value, right: &Value) -> bool {
    matches!(
        (left, right),
        (Value::Number(_), Value::Number(_))
            | (Value::Text(_), Value::Text(_))
            | (Value::Bool(_), Value::Bool(_))
    )
}

/// `">5"` into the comparison it means and the value it compares against.
fn split_criterion(text: &str) -> (Test, Value) {
    let trimmed = text.trim();

    let (test, rest) = if let Some(rest) = trimmed.strip_prefix(">=") {
        (Test::GreaterOrEqual, rest)
    } else if let Some(rest) = trimmed.strip_prefix("<=") {
        (Test::LessOrEqual, rest)
    } else if let Some(rest) = trimmed.strip_prefix("<>") {
        (Test::NotEqual, rest)
    } else if let Some(rest) = trimmed.strip_prefix('>') {
        (Test::Greater, rest)
    } else if let Some(rest) = trimmed.strip_prefix('<') {
        (Test::Less, rest)
    } else if let Some(rest) = trimmed.strip_prefix('=') {
        (Test::Equal, rest)
    } else {
        (Test::Equal, trimmed)
    };

    let value = match crate::value::parse_number(rest) {
        Some(number) => Value::Number(number),
        None => Value::Text(rest.to_string()),
    };

    (test, value)
}

/// A pattern where `*` stands for anything and `?` for one letter.
///
/// Walked rather than turned into a regular expression, because the crate
/// carries no dependencies and this is the whole of what the pattern language
/// is. Case is ignored, as everywhere else a spreadsheet compares words.
fn glob(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let text: Vec<char> = text.to_lowercase().chars().collect();

    let mut here = 0usize;
    let mut there = 0usize;
    let mut star: Option<(usize, usize)> = None;

    while there < text.len() {
        match pattern.get(here) {
            Some('*') => {
                star = Some((here, there));
                here += 1;
            }
            Some('?') => {
                here += 1;
                there += 1;
            }
            Some(letter) if *letter == text[there] => {
                here += 1;
                there += 1;
            }
            // Back to the last star and let it swallow one more letter.
            _ => match star {
                Some((at, from)) => {
                    here = at + 1;
                    there = from + 1;
                    star = Some((at, from + 1));
                }
                None => return false,
            },
        }
    }

    while pattern.get(here) == Some(&'*') {
        here += 1;
    }

    here == pattern.len()
}

/// The (range, criterion) pairs an `*IFS` function was given.
///
/// Excel wants them in twos: a range to test and the little sentence to test
/// it against. An odd number left over is a formula somebody is still
/// writing, not a criterion with no range.
pub fn pairs(
    arguments: &[Expr],
    from: usize,
    context: &Context<'_>,
) -> Result<Vec<(Array, Value)>, Error> {
    let rest = &arguments[from.min(arguments.len())..];
    if rest.is_empty() || rest.len() % 2 != 0 {
        return Err(Error::Value);
    }

    let mut found = Vec::new();
    for pair in rest.chunks(2) {
        let range = super::table(Some(&pair[0]), context)?;
        let criterion = crate::eval::evaluate(&pair[1], context);
        found.push((range, criterion));
    }

    Ok(found)
}

/// The positions that answer every criterion at once.
///
/// The ranges are lined up by position, so Excel wants them all the same
/// shape: a shorter one is a mistake rather than a shorter answer, and
/// answering anyway would total a column against the wrong rows.
pub fn all_matching(pairs: &[(Array, Value)]) -> Result<Vec<usize>, Error> {
    let Some((first, _)) = pairs.first() else {
        return Ok(Vec::new());
    };

    let size = first.values.len();
    if pairs.iter().any(|(range, _)| range.values.len() != size) {
        return Err(Error::Value);
    }

    let mut found = Vec::new();
    'positions: for index in 0..size {
        for (range, criterion) in pairs {
            if !matches(&range.values[index], criterion)? {
                continue 'positions;
            }
        }
        found.push(index);
    }

    Ok(found)
}
