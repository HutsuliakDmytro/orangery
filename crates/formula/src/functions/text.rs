//! Words.
//!
//! Two things here are counted from one rather than from nought — `MID` and
//! `FIND` — because that is how a spreadsheet counts, and a text function that
//! was out by one would be wrong in every cell it touched.

use super::{done, number, string, values, Function};
use crate::ast::Expr;
use crate::eval::Context;
use crate::value::{parse_number, Error, Value};

macro_rules! function {
    ($constant:ident, $name:literal, $least:expr, $most:expr, $body:expr) => {
        pub static $constant: Function = Function {
            name: $name,
            min_arguments: $least,
            max_arguments: $most,
            volatile: false,
            call: $body,
        };
    };
}

function!(REPLACE, "REPLACE", 4, Some(4), |arguments, context| {
    done((|| {
        let text = letters(&string(arguments.first(), context)?);
        let from = number(arguments.get(1), context)?.trunc();
        let how_many = number(arguments.get(2), context)?.trunc();
        let with = string(arguments.get(3), context)?;

        if from < 1.0 || how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        // Counted from one, and a start past the end is an append rather than
        // a mistake: `REPLACE("ab",9,1,"c")` is "abc" in Excel.
        let start = (from as usize - 1).min(text.len());
        let end = (start + how_many as usize).min(text.len());

        let mut made: String = text[..start].iter().collect();
        made.push_str(&with);
        made.extend(text[end..].iter());

        Ok(Value::Text(made))
    })())
});

function!(PROPER, "PROPER", 1, Some(1), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let mut made = String::new();
        // A letter after anything that is not a letter begins a word, so
        // `o'neill` becomes `O'Neill` — which is Excel's answer, wrong about
        // that name and right about `mary-jane`.
        let mut starting = true;

        for letter in text.chars() {
            if starting {
                made.extend(letter.to_uppercase());
            } else {
                made.extend(letter.to_lowercase());
            }
            starting = !letter.is_alphabetic();
        }

        Ok(Value::Text(made))
    })())
});

function!(CLEAN, "CLEAN", 1, Some(1), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        // The first thirty-two, which are what a mainframe export leaves in a
        // column and what nobody can see until it will not match anything.
        Ok(Value::Text(
            text.chars().filter(|letter| *letter >= ' ').collect(),
        ))
    })())
});

function!(VALUE, "VALUE", 1, Some(1), |arguments, context| {
    done((|| {
        let value = crate::eval::evaluate(&arguments[0], context);
        // A number is already one; Excel hands it back rather than refusing.
        if let Value::Number(number) = value {
            return Ok(Value::Number(number));
        }

        let text = value.to_text()?;
        if let Some(number) = parse_number(&text) {
            return Ok(Value::Number(number));
        }

        // A date or a time written out is a number too, which is what makes
        // `VALUE` the thing people reach for after a text import.
        if let Some(serial) = super::datetime::date_from_text(&text, context.cells.date_system()) {
            return Ok(Value::Number(serial));
        }
        if let Some(fraction) = super::datetime::time_from_text(&text) {
            return Ok(Value::Number(fraction));
        }

        Ok(Value::Error(Error::Value))
    })())
});

function!(CHAR, "CHAR", 1, Some(1), |arguments, context| {
    done((|| {
        let code = number(arguments.first(), context)?.trunc();
        if !(1.0..=255.0).contains(&code) {
            return Ok(Value::Error(Error::Value));
        }

        match ansi_letter(code as u16) {
            Some(letter) => Ok(Value::Text(letter.to_string())),
            None => Ok(Value::Error(Error::Value)),
        }
    })())
});

function!(CODE, "CODE", 1, Some(1), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        match text.chars().next() {
            None => Ok(Value::Error(Error::Value)),
            Some(letter) => Ok(Value::Number(ansi_code(letter) as f64)),
        }
    })())
});

function!(UNICHAR, "UNICHAR", 1, Some(1), |arguments, context| {
    done((|| {
        let code = number(arguments.first(), context)?.trunc();
        if code < 1.0 {
            return Ok(Value::Error(Error::Value));
        }

        // The other half of the pair, and the one that means the same thing
        // on every machine: a code point rather than a place in a code page.
        match u32::try_from(code as i64).ok().and_then(char::from_u32) {
            Some(letter) => Ok(Value::Text(letter.to_string())),
            None => Ok(Value::Error(Error::Value)),
        }
    })())
});

function!(UNICODE, "UNICODE", 1, Some(1), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        match text.chars().next() {
            None => Ok(Value::Error(Error::Value)),
            Some(letter) => Ok(Value::Number(letter as u32 as f64)),
        }
    })())
});

function!(
    TEXTBEFORE,
    "TEXTBEFORE",
    2,
    Some(3),
    |arguments, context| { done(either_side(arguments, context, true)) }
);

function!(TEXTAFTER, "TEXTAFTER", 2, Some(3), |arguments, context| {
    done(either_side(arguments, context, false))
});

/// `TEXTBEFORE` and `TEXTAFTER`, which differ only in which half is kept.
///
/// A delimiter that is not there is `#N/A` rather than the whole string or
/// none of it: "the part before the comma" of something with no comma in it
/// is a question with no answer, and either half would be a guess at which
/// one was wanted.
fn either_side(arguments: &[Expr], context: &Context<'_>, before: bool) -> Result<Value, Error> {
    let text = string(arguments.first(), context)?;
    let delimiter = string(arguments.get(1), context)?;
    let which = match arguments.get(2) {
        None => 1.0,
        Some(_) => number(arguments.get(2), context)?.trunc(),
    };

    if delimiter.is_empty() || which == 0.0 {
        return Ok(Value::Error(Error::Value));
    }

    let places: Vec<usize> = text.match_indices(&delimiter).map(|(at, _)| at).collect();

    // A negative count is from the end, which is how somebody asks for the
    // last one without counting them first.
    let index = if which > 0.0 {
        which as usize - 1
    } else {
        match places.len().checked_sub((-which) as usize) {
            Some(index) => index,
            None => return Ok(Value::Error(Error::NotAvailable)),
        }
    };

    let Some(at) = places.get(index).copied() else {
        return Ok(Value::Error(Error::NotAvailable));
    };

    Ok(Value::Text(if before {
        text[..at].to_string()
    } else {
        text[at + delimiter.len()..].to_string()
    }))
}

/// The character a code stands for, as Excel's `CHAR` reads one.
///
/// The first hundred and twenty-seven are ASCII and settled. Above that Excel
/// reads the machine's code page, which on Windows is 1252 — and 1252 is
/// Latin-1 everywhere except the thirty-two places where it keeps the
/// typographer's quotes and dashes instead of control codes. Those thirty-two
/// are written out because they are the ones a real file has in it.
fn ansi_letter(code: u16) -> Option<char> {
    const TYPOGRAPHIC: [char; 32] = [
        '\u{20ac}', '\u{81}', '\u{201a}', '\u{192}', '\u{201e}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{2c6}', '\u{2030}', '\u{160}', '\u{2039}', '\u{152}', '\u{8d}', '\u{17d}',
        '\u{8f}', '\u{90}', '\u{2018}', '\u{2019}', '\u{201c}', '\u{201d}', '\u{2022}', '\u{2013}',
        '\u{2014}', '\u{2dc}', '\u{2122}', '\u{161}', '\u{203a}', '\u{153}', '\u{9d}', '\u{17e}',
        '\u{178}',
    ];

    match code {
        1..=127 | 160..=255 => char::from_u32(u32::from(code)),
        128..=159 => TYPOGRAPHIC.get(usize::from(code - 128)).copied(),
        _ => None,
    }
}

/// And back again, for `CODE`.
fn ansi_code(letter: char) -> u32 {
    let code = letter as u32;
    if matches!(code, 1..=127 | 160..=255) {
        return code;
    }

    for candidate in 128..=159u16 {
        if ansi_letter(candidate) == Some(letter) {
            return u32::from(candidate);
        }
    }

    // Excel answers 63 — a question mark — for anything its code page has no
    // room for, which is what the conversion itself would produce.
    63
}

/// The letters of a value, as a reader counts them.
///
/// Not bytes and not code points: `ї` can be written as two code points and is
/// one letter, so `LEN` over a Ukrainian word has to agree with the person
/// looking at it.
fn letters(text: &str) -> Vec<char> {
    text.chars().collect()
}

function!(LEN, "LEN", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| Value::Number(letters(&text).len() as f64)))
});

function!(LEFT, "LEFT", 1, Some(2), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let how_many = match arguments.get(1) {
            None => 1.0,
            Some(_) => number(arguments.get(1), context)?,
        };

        if how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        let taken: String = letters(&text).into_iter().take(how_many as usize).collect();
        Ok(Value::Text(taken))
    })())
});

function!(RIGHT, "RIGHT", 1, Some(2), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let how_many = match arguments.get(1) {
            None => 1.0,
            Some(_) => number(arguments.get(1), context)?,
        };

        if how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        let all = letters(&text);
        let from = all.len().saturating_sub(how_many as usize);
        Ok(Value::Text(all[from..].iter().collect()))
    })())
});

function!(MID, "MID", 3, Some(3), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let from = number(arguments.get(1), context)?;
        let how_many = number(arguments.get(2), context)?;

        // Counted from one, and nought is not a place in a string.
        if from < 1.0 || how_many < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        let all = letters(&text);
        let start = (from as usize) - 1;
        if start >= all.len() {
            return Ok(Value::Text(String::new()));
        }

        let end = (start + how_many as usize).min(all.len());
        Ok(Value::Text(all[start..end].iter().collect()))
    })())
});

function!(UPPER, "UPPER", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| Value::Text(text.to_uppercase())))
});

function!(LOWER, "LOWER", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| Value::Text(text.to_lowercase())))
});

function!(TRIM, "TRIM", 1, Some(1), |arguments, context| {
    done(string(arguments.first(), context).map(|text| {
        // Excel's `TRIM` also squeezes the spaces inside: it exists for text
        // that came out of a system that padded its columns.
        let squeezed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        Value::Text(squeezed)
    }))
});

function!(CONCAT, "CONCAT", 1, None, |arguments, context| {
    done(joined(arguments, context, "", false))
});

function!(CONCATENATE, "CONCATENATE", 1, None, |arguments, context| {
    done(joined(arguments, context, "", false))
});

function!(TEXTJOIN, "TEXTJOIN", 3, None, |arguments, context| {
    done((|| {
        let separator = string(arguments.first(), context)?;
        let skip_blanks = crate::eval::evaluate(&arguments[1], context).to_bool()?;

        joined(&arguments[2..], context, &separator, skip_blanks)
    })())
});

function!(EXACT, "EXACT", 2, Some(2), |arguments, context| {
    done((|| {
        let first = string(arguments.first(), context)?;
        let second = string(arguments.get(1), context)?;

        // The one text comparison in a spreadsheet that does mind the case,
        // which is the whole reason it exists.
        Ok(Value::Bool(first == second))
    })())
});

function!(FIND, "FIND", 2, Some(3), |arguments, context| {
    done(found(arguments, context, true))
});

function!(SEARCH, "SEARCH", 2, Some(3), |arguments, context| {
    // The same thing without the case, which is the difference people forget.
    done(found(arguments, context, false))
});

function!(
    SUBSTITUTE,
    "SUBSTITUTE",
    3,
    Some(4),
    |arguments, context| {
        done((|| {
            let text = string(arguments.first(), context)?;
            let from = string(arguments.get(1), context)?;
            let to = string(arguments.get(2), context)?;

            if from.is_empty() {
                return Ok(Value::Text(text));
            }

            let which = match arguments.get(3) {
                None => None,
                Some(_) => Some(number(arguments.get(3), context)? as usize),
            };

            match which {
                None => Ok(Value::Text(text.replace(&from, &to))),
                Some(0) => Ok(Value::Error(Error::Value)),
                Some(nth) => {
                    // Only the nth one, counted from the left, which is what the
                    // fourth argument is for.
                    let mut result = String::new();
                    let mut rest = text.as_str();
                    let mut seen = 0usize;

                    while let Some(at) = rest.find(&from) {
                        seen += 1;
                        result.push_str(&rest[..at]);

                        if seen == nth {
                            result.push_str(&to);
                        } else {
                            result.push_str(&from);
                        }

                        rest = &rest[at + from.len()..];
                    }

                    result.push_str(rest);
                    Ok(Value::Text(result))
                }
            }
        })())
    }
);

function!(REPT, "REPT", 2, Some(2), |arguments, context| {
    done((|| {
        let text = string(arguments.first(), context)?;
        let times = number(arguments.get(1), context)?;

        if times < 0.0 {
            return Ok(Value::Error(Error::Value));
        }

        Ok(Value::Text(text.repeat(times as usize)))
    })())
});

/// `CONCAT`, `CONCATENATE` and `TEXTJOIN`, which differ in what goes between.
fn joined(
    arguments: &[crate::ast::Expr],
    context: &crate::eval::Context<'_>,
    separator: &str,
    skip_blanks: bool,
) -> Result<Value, Error> {
    let mut pieces: Vec<String> = Vec::new();

    for value in values(arguments, context) {
        match value {
            Value::Array(array) => {
                for inside in array.values {
                    if skip_blanks && matches!(inside, Value::Blank) {
                        continue;
                    }
                    pieces.push(inside.to_text()?);
                }
            }
            Value::Blank if skip_blanks => {}
            other => pieces.push(other.to_text()?),
        }
    }

    Ok(Value::Text(pieces.join(separator)))
}

/// `FIND` and `SEARCH`: where one string sits inside another, counted from one.
fn found(
    arguments: &[crate::ast::Expr],
    context: &crate::eval::Context<'_>,
    case_matters: bool,
) -> Result<Value, Error> {
    let needle = string(arguments.first(), context)?;
    let haystack = string(arguments.get(1), context)?;

    let from = match arguments.get(2) {
        None => 1.0,
        Some(_) => number(arguments.get(2), context)?,
    };

    if from < 1.0 {
        return Ok(Value::Error(Error::Value));
    }

    let all = letters(&haystack);
    let start = (from as usize) - 1;
    if start > all.len() {
        return Ok(Value::Error(Error::Value));
    }

    let rest: String = all[start..].iter().collect();
    let (rest, needle) = if case_matters {
        (rest, needle)
    } else {
        (rest.to_lowercase(), needle.to_lowercase())
    };

    match rest.find(&needle) {
        // Counted in letters rather than in bytes, and from one.
        Some(at) => {
            let letters_before = rest[..at].chars().count();
            Ok(Value::Number((start + letters_before + 1) as f64))
        }
        // Not there at all is `#VALUE!`, which is what `IFERROR` is usually
        // wrapped around.
        None => Ok(Value::Error(Error::Value)),
    }
}
