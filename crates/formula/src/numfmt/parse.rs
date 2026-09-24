//! A format code, taken apart.
//!
//! `#,##0.00;[Red](#,##0.00);"—";@` is four formats in one string: what a
//! positive number looks like, a negative, a zero, and text. Excel's little
//! language has been added to for thirty years and reads like it — the same
//! letter means different things in different places, and the only way to
//! know which is to look at what is around it.
//!
//! Two of those ambiguities matter enough to name:
//!
//! - **`m` is a month or a minute.** After an hour or before a second it is
//!   minutes; everywhere else it is months. `h:m:s` is a clock and `m/d/yyyy`
//!   is a date, and the letters are the same.
//! - **`/` is a fraction or a date separator.** In `# ?/?` it divides; in
//!   `d/m/yyyy` it is a stroke between numbers.
//!
//! Both are decided by what kind of section it is, which is decided first.

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Digit(char),
    Decimal,
    /// A comma between digits, which groups thousands.
    Group,
    /// A comma after the digits, dividing by a thousand for each one.
    Scale(f64),
    Percent,
    Literal(String),
    /// `*x` — repeat until the cell is full, which only a grid can do.
    Fill(char),
    /// `_x` — a space as wide as the character, for lining columns up.
    Pad(char),
    /// `@` — where the text goes in a text section.
    Text,
    /// `E+` or `e-`: which of the two, and the letter, because Excel echoes
    /// the case it was given.
    Exponent {
        plus: bool,
        letter: char,
    },
    Fraction,
    Date(String),
    /// `[h]`, `[mm]`, `[ss]` — a unit that counts past its own wrap.
    Elapsed(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Comparison {
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
    Equal,
    NotEqual,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Condition {
    pub operator: Comparison,
    pub value: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Number,
    Date,
    Text,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub tokens: Vec<Token>,
    /// `[Red]` and the rest, as written; the caller decides what red is.
    pub color: Option<String>,
    /// `[>=100]` — which numbers this section is for.
    pub condition: Option<Condition>,
    pub kind: Kind,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NumberFormat {
    pub sections: Vec<Section>,
}

const COLORS: [&str; 8] = [
    "black", "blue", "cyan", "green", "magenta", "red", "white", "yellow",
];

/// Splits on the semicolons that separate sections, ignoring the quoted ones.
fn sections_of(code: &str) -> Vec<String> {
    let letters: Vec<char> = code.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut bracketed = false;
    let mut at = 0;

    while at < letters.len() {
        let letter = letters[at];

        if letter == '\\' && !quoted {
            current.push(letter);
            if let Some(next) = letters.get(at + 1) {
                current.push(*next);
            }
            at += 2;
            continue;
        }
        if letter == '"' {
            quoted = !quoted;
        }
        if !quoted && letter == '[' {
            bracketed = true;
        }
        if !quoted && letter == ']' {
            bracketed = false;
        }

        if letter == ';' && !quoted && !bracketed {
            parts.push(std::mem::take(&mut current));
            at += 1;
            continue;
        }

        current.push(letter);
        at += 1;
    }

    parts.push(current);
    parts
}

fn is_date_letter(letter: char) -> bool {
    matches!(letter.to_ascii_lowercase(), 'y' | 'm' | 'd' | 'h' | 's')
}

/// Whether the inside of a bracket is an elapsed unit rather than an
/// annotation: `[h]`, `[mm]`, `[ss]`.
fn is_elapsed(inside: &str) -> bool {
    !inside.is_empty()
        && inside
            .chars()
            .all(|letter| matches!(letter.to_ascii_lowercase(), 'h' | 'm' | 's'))
}

/// Whether a section formats a date.
///
/// Decided before anything else is read, because it is what makes `m` a month
/// and `/` a stroke. Letters inside quotes or brackets do not count: `0
/// "months"` is a number, however much it talks about time.
fn looks_like_date(body: &str) -> bool {
    let letters: Vec<char> = body.chars().collect();
    let mut bare = String::new();
    let mut at = 0;

    while at < letters.len() {
        match letters[at] {
            '"' => {
                at += 1;
                while at < letters.len() && letters[at] != '"' {
                    at += 1;
                }
                at += 1;
            }
            '\\' => at += 2,
            '[' => {
                let end = (at + 1..letters.len())
                    .find(|index| letters[*index] == ']')
                    .unwrap_or(letters.len());
                let inside: String = letters[at + 1..end.min(letters.len())].iter().collect();
                if is_elapsed(&inside) {
                    return true;
                }
                at = end + 1;
            }
            letter => {
                bare.push(letter);
                at += 1;
            }
        }
    }

    bare.chars().any(is_date_letter)
}

/// What a section says in brackets: its colour, its condition, its currency.
struct Bracketed {
    rest: String,
    color: Option<String>,
    condition: Option<Condition>,
    currency: Option<String>,
}

fn read_brackets(body: &str) -> Bracketed {
    let letters: Vec<char> = body.chars().collect();
    let mut rest = String::new();
    let mut found = Bracketed {
        rest: String::new(),
        color: None,
        condition: None,
        currency: None,
    };

    let mut at = 0;
    while at < letters.len() {
        // Quoted runs are stepped over: `"[" @ "]"` is a text format with
        // square brackets in it, not a colour and a condition.
        if letters[at] == '"' {
            rest.push('"');
            at += 1;
            while at < letters.len() && letters[at] != '"' {
                rest.push(letters[at]);
                at += 1;
            }
            if at < letters.len() {
                rest.push('"');
                at += 1;
            }
            continue;
        }

        if letters[at] == '\\' {
            rest.push('\\');
            if let Some(next) = letters.get(at + 1) {
                rest.push(*next);
            }
            at += 2;
            continue;
        }

        if letters[at] != '[' {
            rest.push(letters[at]);
            at += 1;
            continue;
        }

        let Some(end) = (at + 1..letters.len()).find(|index| letters[*index] == ']') else {
            rest.push('[');
            at += 1;
            continue;
        };

        let inside: String = letters[at + 1..end].iter().collect();
        let lower = inside.to_lowercase();

        // An elapsed unit is a token rather than an annotation, so it stays.
        if is_elapsed(&inside) {
            rest.push('[');
            rest.push_str(&inside);
            rest.push(']');
            at = end + 1;
            continue;
        }

        if COLORS.contains(&lower.as_str()) || is_numbered_color(&lower) {
            found.color = Some(inside);
            at = end + 1;
            continue;
        }

        if let Some(condition) = read_condition(&inside) {
            found.condition = Some(condition);
            at = end + 1;
            continue;
        }

        // `[$€-407]` states a currency and a locale; `[$-409]` states only
        // the locale, which decides month names in Excel and is ignored here.
        // The difference is whether there is a symbol before the dash.
        if let Some(money) = inside.strip_prefix('$') {
            let symbol = money.split('-').next().unwrap_or("");
            if !symbol.is_empty() {
                found.currency = Some(symbol.to_string());
            }
            at = end + 1;
            continue;
        }

        // Anything else in brackets — a locale on its own, a calendar — says
        // nothing this can act on and nothing worth showing.
        at = end + 1;
    }

    found.rest = rest;
    found
}

fn is_numbered_color(lower: &str) -> bool {
    match lower.strip_prefix("color") {
        Some(rest) => {
            let digits = rest.trim();
            !digits.is_empty() && digits.chars().all(|letter| letter.is_ascii_digit())
        }
        None => false,
    }
}

fn read_condition(inside: &str) -> Option<Condition> {
    // The two-letter operators first: `<=` read as `<` would leave an equals
    // sign where a number should be, and the condition would be thrown away.
    let (operator, rest) = if let Some(rest) = inside.strip_prefix(">=") {
        (Comparison::GreaterOrEqual, rest)
    } else if let Some(rest) = inside.strip_prefix("<=") {
        (Comparison::LessOrEqual, rest)
    } else if let Some(rest) = inside.strip_prefix("<>") {
        (Comparison::NotEqual, rest)
    } else if let Some(rest) = inside.strip_prefix('>') {
        (Comparison::Greater, rest)
    } else if let Some(rest) = inside.strip_prefix('<') {
        (Comparison::Less, rest)
    } else {
        (Comparison::Equal, inside.strip_prefix('=')?)
    };

    let value: f64 = rest.trim().parse().ok()?;
    Some(Condition { operator, value })
}

/// Runs of the same date letter are one token: `yyyy` is a year, not four.
fn date_run(letters: &[char], at: usize) -> String {
    let letter = letters[at].to_ascii_lowercase();
    let mut end = at;

    while letters
        .get(end + 1)
        .is_some_and(|next| next.to_ascii_lowercase() == letter)
    {
        end += 1;
    }

    letters[at..=end].iter().collect()
}

fn tokenise(body: &str, kind: Kind, currency: Option<String>) -> Vec<Token> {
    let letters: Vec<char> = body.chars().collect();
    let mut tokens: Vec<Token> = Vec::new();
    let mut at = 0;

    while at < letters.len() {
        let letter = letters[at];

        if letter == '"' {
            let end = (at + 1..letters.len())
                .find(|index| letters[*index] == '"')
                .unwrap_or(letters.len());
            tokens.push(Token::Literal(
                letters[at + 1..end.min(letters.len())].iter().collect(),
            ));
            at = end + 1;
            continue;
        }

        if letter == '\\' {
            tokens.push(Token::Literal(
                letters.get(at + 1).copied().unwrap_or(' ').to_string(),
            ));
            at += 2;
            continue;
        }

        if letter == '_' {
            tokens.push(Token::Pad(letters.get(at + 1).copied().unwrap_or(' ')));
            at += 2;
            continue;
        }

        if letter == '*' {
            tokens.push(Token::Fill(letters.get(at + 1).copied().unwrap_or(' ')));
            at += 2;
            continue;
        }

        if letter == '[' {
            let end = (at + 1..letters.len())
                .find(|index| letters[*index] == ']')
                .unwrap_or(letters.len());
            let inside: String = letters[at + 1..end.min(letters.len())].iter().collect();
            if is_elapsed(&inside) {
                tokens.push(Token::Elapsed(inside));
            }
            at = end + 1;
            continue;
        }

        if matches!(letter, '0' | '#' | '?') {
            tokens.push(Token::Digit(letter));
            at += 1;
            continue;
        }

        if letter == '.' {
            // A date's dot separates — `dd.mm.yy` — unless it is the point
            // before a fraction of a second, decided by what follows it.
            let fraction_of_second =
                kind == Kind::Date && letters.get(at + 1).is_some_and(|next| *next == '0');
            tokens.push(if kind == Kind::Date && !fraction_of_second {
                Token::Literal(".".to_string())
            } else {
                Token::Decimal
            });
            at += 1;
            continue;
        }

        if letter == '%' {
            tokens.push(Token::Percent);
            at += 1;
            continue;
        }

        if letter == '@' {
            tokens.push(Token::Text);
            at += 1;
            continue;
        }

        if matches!(letter, 'E' | 'e') && matches!(letters.get(at + 1), Some('+') | Some('-')) {
            tokens.push(Token::Exponent {
                plus: letters[at + 1] == '+',
                letter,
            });
            at += 2;
            continue;
        }

        if letter == ',' {
            // In a date a comma is punctuation — `mmm d, yyyy`. In a number
            // it is either grouping or scaling, and which one depends on what
            // follows, so the scaling ones are folded together afterwards.
            tokens.push(if kind == Kind::Date {
                Token::Literal(",".to_string())
            } else {
                Token::Group
            });
            at += 1;
            continue;
        }

        if letter == '/' && kind == Kind::Number {
            tokens.push(Token::Fraction);
            at += 1;
            continue;
        }

        if kind == Kind::Date {
            let ahead: String = letters[at..].iter().collect();
            let upper = ahead.to_uppercase();
            if upper.starts_with("AM/PM") {
                tokens.push(Token::Date(letters[at..at + 5].iter().collect()));
                at += 5;
                continue;
            }
            if upper.starts_with("A/P") {
                tokens.push(Token::Date(letters[at..at + 3].iter().collect()));
                at += 3;
                continue;
            }

            if is_date_letter(letter) {
                let run = date_run(&letters, at);
                at += run.chars().count();
                tokens.push(Token::Date(run));
                continue;
            }
        }

        tokens.push(Token::Literal(letter.to_string()));
        at += 1;
    }

    if let Some(symbol) = currency {
        tokens.insert(0, Token::Literal(symbol));
    }

    settle_commas(tokens)
}

/// What each comma in a number turns out to be.
///
/// Three different things wear the same character, and only their neighbours
/// tell them apart:
///
/// - **a separator**, between two places — `#,##0` shows thousands;
/// - **a divisor**, anywhere else among the places — `#,##0,` shows thousands
///   of thousands, and `#,.#,` divides twice on its way to the point;
/// - **a comma**, where no place has come yet — `,#` on a million and a bit
///   is `,1234567`, a literal comma and a number with no grouping at all.
///
/// The first of those is the only one anybody writes on purpose, which is why
/// the other two are easy to get wrong.
fn settle_commas(tokens: Vec<Token>) -> Vec<Token> {
    let mut settled: Vec<Token> = Vec::new();
    let mut seen_place = false;

    for (index, token) in tokens.iter().enumerate() {
        if *token != Token::Group {
            if matches!(token, Token::Digit(_)) {
                seen_place = true;
            }
            settled.push(token.clone());
            continue;
        }

        if !seen_place {
            settled.push(Token::Literal(",".to_string()));
            continue;
        }

        let before = index.checked_sub(1).and_then(|at| tokens.get(at));
        let after = tokens.get(index + 1);
        if matches!(before, Some(Token::Digit(_))) && matches!(after, Some(Token::Digit(_))) {
            settled.push(Token::Group);
            continue;
        }

        match settled.last_mut() {
            Some(Token::Scale(by)) => *by *= 1000.0,
            _ => settled.push(Token::Scale(1000.0)),
        }
    }

    settled
}

/// The AM/PM marker turns a 24-hour format into a 12-hour one.
///
/// Stated here rather than found later because it changes what `h` means, and
/// the hour is written long before the marker is reached.
pub fn is_twelve_hour(section: &Section) -> bool {
    section.tokens.iter().any(|token| match token {
        Token::Date(code) => {
            let upper = code.to_uppercase();
            upper == "AM/PM" || upper == "A/P"
        }
        _ => false,
    })
}

pub fn parse_format(code: &str) -> NumberFormat {
    let sections = sections_of(code)
        .into_iter()
        .map(|body| {
            let read = read_brackets(&body);
            let kind = if looks_like_date(&read.rest) {
                Kind::Date
            } else if read.rest.contains('@') {
                Kind::Text
            } else {
                Kind::Number
            };

            Section {
                tokens: tokenise(&read.rest, kind, read.currency),
                color: read.color,
                condition: read.condition,
                kind,
            }
        })
        .collect();

    NumberFormat { sections }
}
