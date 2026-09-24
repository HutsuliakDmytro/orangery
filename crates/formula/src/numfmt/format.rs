//! A value, shown the way its format says.
//!
//! Nothing here changes the value. A format that rounds to two places rounds
//! the picture, and the cell keeps every digit it had — which is why a column
//! of rounded numbers still adds up to what it adds up to.

use super::parse::{parse_format, Comparison, Condition, Kind, NumberFormat, Section, Token};
use crate::date::{clock_of, date_of, elapsed_of, weekday_of, DateSystem};

/// What is being shown: a number, or words.
#[derive(Debug, Clone, Copy)]
pub enum Shown<'a> {
    Number(f64),
    Text(&'a str),
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const MONTHS_SHORT: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const DAYS_SHORT: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/// A value as its format shows it.
///
/// A format that cannot be read at all shows the value as `General` does: a
/// cell showing its number is a smaller failure than a cell showing an error.
pub fn format_value(value: Shown<'_>, code: &str, system: DateSystem) -> String {
    let format = parse_format(code);
    let Some((section, signed)) = section_for(&format, value) else {
        return match value {
            Shown::Number(number) => format_general(number),
            Shown::Text(text) => text.to_string(),
        };
    };

    match value {
        Shown::Text(text) => format_text(text, Some(section)),
        Shown::Number(number) => {
            if code.eq_ignore_ascii_case("general") {
                return format_general(number);
            }

            match section.kind {
                Kind::Date => format_date(number, section, system),
                Kind::Text => format_text(&format_general(number), Some(section)),
                Kind::Number => {
                    let shown = if signed { number.abs() } else { number };
                    format_number(shown, section, signed)
                }
            }
        }
    }
}

fn holds_text(section: &Section) -> bool {
    section.tokens.contains(&Token::Text)
}

/// Which section a value is shown by.
///
/// Without conditions the order is fixed: positive, negative, zero, text —
/// and a format with fewer sections spreads them, so one section serves every
/// number and two split it at zero. With conditions the sections are tried in
/// order and the last unconditional one is the else, which is why `[>100]`
/// and `[<0]` can be followed by a plain third.
fn section_for<'a>(format: &'a NumberFormat, value: Shown<'_>) -> Option<(&'a Section, bool)> {
    let sections = &format.sections;
    if sections.is_empty() {
        return None;
    }

    if let Shown::Text(_) = value {
        // A text section is the fourth, or the only one that mentions text.
        let text = sections
            .get(3)
            .or_else(|| sections.iter().find(|section| holds_text(section)));
        return text.map(|section| (section, false));
    }

    let Shown::Number(number) = value else {
        return None;
    };

    let conditional: Vec<&Section> = sections
        .iter()
        .filter(|section| section.condition.is_some())
        .collect();

    if !conditional.is_empty() {
        let matched = conditional
            .iter()
            .find(|section| matches_condition(section.condition.as_ref(), number))
            .copied();
        let chosen =
            matched.or_else(|| sections.iter().find(|section| section.condition.is_none()));

        // A section chosen by its condition writes whatever sign it wants: a
        // format that says `[<0]"under"` is not asking for a minus as well.
        return chosen.map(|section| (section, matched.is_some()));
    }

    let positive = sections.first();
    let negative = sections.get(1);
    let zero = sections.get(2);

    if number < 0.0 {
        if let Some(section) = negative {
            // Shown the value without its sign, because the section is what
            // the sign looks like — often brackets rather than a dash.
            return Some((section, true));
        }
    }
    if number == 0.0 {
        if let Some(section) = zero {
            return Some((section, false));
        }
    }

    positive.map(|section| (section, false))
}

fn matches_condition(condition: Option<&Condition>, value: f64) -> bool {
    let Some(condition) = condition else {
        return false;
    };

    match condition.operator {
        Comparison::Less => value < condition.value,
        Comparison::LessOrEqual => value <= condition.value,
        Comparison::Greater => value > condition.value,
        Comparison::GreaterOrEqual => value >= condition.value,
        Comparison::Equal => value == condition.value,
        Comparison::NotEqual => value != condition.value,
    }
}

/// How many digits a section asks for on each side of the point.
struct Counts {
    integer: usize,
    /// How many integer places must show a digit even when there is none.
    minimum_integer: usize,
    /// How many must show a space instead, to line the column up.
    padded_integer: usize,
    decimals: usize,
    minimum_decimals: usize,
    grouped: bool,
}

fn digit_counts(tokens: &[Token]) -> Counts {
    let mut counts = Counts {
        integer: 0,
        minimum_integer: 0,
        padded_integer: 0,
        decimals: 0,
        minimum_decimals: 0,
        grouped: false,
    };
    let mut after_point = false;

    for token in tokens {
        match token {
            Token::Decimal => after_point = true,
            Token::Group => counts.grouped = true,
            Token::Digit(placeholder) => {
                if after_point {
                    counts.decimals += 1;
                    if *placeholder == '0' {
                        counts.minimum_decimals = counts.decimals;
                    }
                } else {
                    counts.integer += 1;
                    if *placeholder == '0' {
                        counts.minimum_integer += 1;
                    }
                    if *placeholder == '?' {
                        counts.padded_integer += 1;
                    }
                }
            }
            _ => {}
        }
    }

    counts
}

fn group_thousands(digits: &str) -> String {
    let letters: Vec<char> = digits.chars().collect();
    let leading = letters
        .iter()
        .position(|letter| letter.is_ascii_digit())
        .unwrap_or(letters.len());

    let (head, body) = letters.split_at(leading);
    let mut out: String = head.iter().collect();

    for (at, letter) in body.iter().enumerate() {
        if at > 0 && (body.len() - at) % 3 == 0 {
            out.push(',');
        }
        out.push(*letter);
    }

    out
}

/// The digits of a number, rounded to the places the format asks for.
///
/// Rounded half away from zero, as Excel does: a spreadsheet keeps fifteen
/// significant digits, and the rounding is done on those rather than on the
/// binary value — 1.005 is the example everybody meets.
fn digits_of(value: f64, decimals: usize) -> (String, String) {
    let factor = 10_f64.powi(decimals as i32);
    let scaled = crate::value::round_to_significant(value.abs() * factor, 15).round();
    let text = format!("{:.*}", decimals, scaled / factor);

    match text.split_once('.') {
        Some((whole, fraction)) => (whole.to_string(), fraction.to_string()),
        None => (text, String::new()),
    }
}

/// How wide `General` is allowed to be.
///
/// Eleven characters, counting the decimal point and not the minus sign. It
/// is a width and not a count of significant digits, which is why 0.000000001
/// is shown in full — one significant digit in eleven characters — while
/// 1.2345678912 loses its last digit and 1e-10 is not shown this way at all.
const GENERAL_WIDTH: i32 = 11;

/// The plain decimal picture of a number, if it fits.
///
/// `None` where it does not: either the digits before the point already fill
/// the width, or the number is so small that everything inside the width is a
/// zero. Both are the cases Excel answers with scientific notation instead.
fn fitted(magnitude: f64) -> Option<String> {
    let integer_width = (magnitude.log10().floor() as i32 + 1).max(1);
    if integer_width > GENERAL_WIDTH {
        return None;
    }

    // What is left of the width once the integer digits and the point have
    // had their share; a number with no room for a point keeps none.
    let decimals = (GENERAL_WIDTH - integer_width - 1).clamp(0, 100) as usize;
    let text = format!("{:.*}", decimals, magnitude);

    // Rounding can carry: 99999999999.5 in eleven characters is a twelfth
    // digit, and Excel writes that as an exponent rather than shortening it.
    let whole = text
        .split_once('.')
        .map_or(text.as_str(), |(whole, _)| whole);
    if whole.len() as i32 > GENERAL_WIDTH || text.parse::<f64>().unwrap_or(0.0) == 0.0 {
        return None;
    }

    Some(trim_zeros(&text))
}

/// `General` — the format a cell has when it has none.
///
/// Excel fits the number into eleven characters and reaches for an exponent
/// only when it cannot: 0.000000001 is written out, 0.0000000001 would need a
/// twelfth character and becomes `1E-10`. The rule is about width rather than
/// about digits, which is the part that is easy to get wrong — eleven
/// significant digits would show both of those numbers the same way, and
/// Excel does not.
///
/// Excel's real `General` also narrows itself to the column, which nothing
/// here knows about; this is the width-independent part, and the one `TEXT`
/// uses.
pub fn format_general(value: f64) -> String {
    if !value.is_finite() {
        return "#NUM!".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }

    let sign = if value < 0.0 { "-" } else { "" };
    if let Some(plain) = fitted(value.abs()) {
        return format!("{sign}{plain}");
    }

    // Five places of mantissa, with whatever trailing zeros that leaves taken
    // off again: 1.1e-10 is `1.1E-10` and not `1.10000E-10`.
    let written = format!("{:.5E}", value.abs());
    let (mantissa, power) = written.split_once('E').unwrap_or((written.as_str(), "0"));
    let exponent: i32 = power.parse().unwrap_or(0);

    format!(
        "{sign}{}E{}{:02}",
        trim_zeros(mantissa),
        if exponent < 0 { '-' } else { '+' },
        exponent.abs()
    )
}

fn trim_zeros(text: &str) -> String {
    if !text.contains('.') {
        return text.to_string();
    }

    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn padded(value: i64, length: usize) -> String {
    format!("{:0>width$}", value, width = length)
}

/// A month, or the minutes that are spelled the same way.
fn month_text(code: &str, month: i64) -> String {
    let index = (month - 1).clamp(0, 11) as usize;

    match code.chars().count() {
        1 => month.to_string(),
        2 => padded(month, 2),
        3 => MONTHS_SHORT[index].to_string(),
        5 => MONTHS[index].chars().take(1).collect(),
        _ => MONTHS[index].to_string(),
    }
}

struct Parts {
    year: i64,
    month: i64,
    day: i64,
    hours: i64,
    minutes: i64,
    seconds: i64,
    milliseconds: i64,
    weekday: i64,
}

fn parts_of(serial: f64, system: DateSystem) -> Option<Parts> {
    let civil = date_of(serial, system)?;
    let (hours, minutes, seconds, milliseconds) = clock_of(serial);

    Some(Parts {
        year: civil.year,
        month: civil.month,
        day: civil.day,
        hours,
        minutes,
        seconds,
        milliseconds,
        weekday: weekday_of(serial, system),
    })
}

fn date_text(code: &str, parts: &Parts, twelve_hour: bool, fraction: usize) -> String {
    let lower = code.to_lowercase();
    let length = lower.chars().count();

    match lower.chars().next() {
        Some('y') => {
            if length <= 2 {
                padded(parts.year.rem_euclid(100), 2)
            } else {
                parts.year.to_string()
            }
        }
        Some('m') => month_text(&lower, parts.month),
        Some('d') => match length {
            1 => parts.day.to_string(),
            2 => padded(parts.day, 2),
            3 => DAYS_SHORT[parts.weekday.clamp(0, 6) as usize].to_string(),
            _ => DAYS[parts.weekday.clamp(0, 6) as usize].to_string(),
        },
        Some('h') => {
            let hour = if twelve_hour {
                match parts.hours % 12 {
                    0 => 12,
                    other => other,
                }
            } else {
                parts.hours
            };
            if length == 1 {
                hour.to_string()
            } else {
                padded(hour, 2)
            }
        }
        Some('s') => {
            let text = if length == 1 {
                parts.seconds.to_string()
            } else {
                padded(parts.seconds, 2)
            };

            if fraction > 0 {
                let scale = 10_i64.pow(3 - fraction as u32);
                format!(
                    "{text}.{}",
                    padded(
                        (parts.milliseconds as f64 / scale as f64).round() as i64,
                        fraction
                    )
                )
            } else {
                text
            }
        }
        Some('a') => {
            if parts.hours < 12 {
                "AM".to_string()
            } else {
                "PM".to_string()
            }
        }
        _ => String::new(),
    }
}

fn unit_of(token: &Token) -> Option<char> {
    match token {
        Token::Date(code) | Token::Elapsed(code) => code
            .chars()
            .next()
            .map(|letter| letter.to_ascii_lowercase()),
        _ => None,
    }
}

/// `m` as minutes rather than months, where its neighbours say so.
///
/// Excel's own rule: a month becomes a minute when an hour comes before it or
/// a second after it, with only separators in between. It is the one piece of
/// this language that cannot be decided by looking at the token alone.
fn minute_tokens(tokens: &[Token]) -> Vec<usize> {
    let mut minutes = Vec::new();

    for (index, token) in tokens.iter().enumerate() {
        let Token::Date(code) = token else { continue };
        if !code.chars().all(|letter| letter.eq_ignore_ascii_case(&'m')) {
            continue;
        }

        let before = tokens[..index].iter().rev().find_map(unit_of);
        let after = tokens[index + 1..].iter().find_map(unit_of);

        if before == Some('h') || after == Some('s') {
            minutes.push(index);
        }
    }

    minutes
}

/// How many decimal places a `ss.00` asks of the seconds.
fn second_fraction(tokens: &[Token]) -> usize {
    let Some(at) = tokens.iter().position(|token| match token {
        Token::Date(code) => code.chars().all(|letter| letter.eq_ignore_ascii_case(&'s')),
        _ => false,
    }) else {
        return 0;
    };

    if tokens.get(at + 1) != Some(&Token::Decimal) {
        return 0;
    }

    tokens[at + 2..]
        .iter()
        .take_while(|token| matches!(token, Token::Digit(_)))
        .count()
        .min(3)
}

fn format_date(value: f64, section: &Section, system: DateSystem) -> String {
    let Some(parts) = parts_of(value, system) else {
        return format_general(value);
    };

    let twelve_hour = super::parse::is_twelve_hour(section);
    let minutes = minute_tokens(&section.tokens);
    let fraction = second_fraction(&section.tokens);
    let elapsed = elapsed_of(value);

    let mut text = String::new();
    for (index, token) in section.tokens.iter().enumerate() {
        match token {
            Token::Date(code) => {
                if minutes.contains(&index) {
                    text.push_str(&if code.chars().count() == 1 {
                        parts.minutes.to_string()
                    } else {
                        padded(parts.minutes, 2)
                    });
                } else {
                    text.push_str(&date_text(code, &parts, twelve_hour, fraction));
                }
            }
            Token::Elapsed(code) => {
                let total = match code.chars().next().map(|l| l.to_ascii_lowercase()) {
                    Some('h') => elapsed.hours,
                    Some('m') => elapsed.minutes,
                    _ => elapsed.seconds,
                };
                if elapsed.negative {
                    text.push('-');
                }
                text.push_str(&padded(total, code.chars().count()));
            }
            Token::Literal(written) => text.push_str(written),
            Token::Pad(_) => text.push(' '),
            // The point and digits of a fractional second, already written
            // with the seconds themselves.
            _ => {}
        }
    }

    text
}

fn format_number(value: f64, section: &Section, signed: bool) -> String {
    let tokens = &section.tokens;
    let counts = digit_counts(tokens);

    // A format in scientific notation has an exponent to move the point
    // with, and Excel does not move it twice: the per-cent sign and the
    // trailing comma are drawn where they stand and multiply nothing.
    // `#%e+#` on 123456 is `1%e+5`, not `1%e+7`.
    if tokens
        .iter()
        .any(|token| matches!(token, Token::Exponent { .. }))
    {
        return scientific(value, section);
    }

    let percent = tokens
        .iter()
        .filter(|token| **token == Token::Percent)
        .count();
    let scale = tokens.iter().fold(1.0, |by, token| match token {
        Token::Scale(each) => by * each,
        _ => by,
    });
    let scaled = value * 100_f64.powi(percent as i32) / scale;

    if tokens.contains(&Token::Fraction) {
        return fractional(scaled, section);
    }

    // A section with no digits at all is a word standing in for a number —
    // `[>=100]"big"` — and appending the digits to it would show "big150".
    if counts.integer == 0 && counts.decimals == 0 && !tokens.contains(&Token::Decimal) {
        return assemble(tokens, "", "", false);
    }

    let (whole, places) = digits_of(scaled, counts.decimals);
    let trimmed = places.trim_end_matches('0');
    let kept: String = places
        .chars()
        .take(counts.minimum_decimals.max(trimmed.chars().count()))
        .collect();

    // `#` means a digit if there is one, `0` means one whether or not, and
    // `?` means a space where there is none. So `#.##` on a half is `.5`
    // while `0.##` is `0.5` — the difference every spreadsheet person knows
    // by sight and nobody can explain from the code alone.
    let required = if whole == "0" && counts.minimum_integer == 0 {
        String::new()
    } else {
        whole
    };
    let filled = pad_start(&required, counts.minimum_integer, '0');
    let spaced = pad_start(
        &filled,
        (counts.minimum_integer + counts.padded_integer).max(filled.chars().count()),
        ' ',
    );

    // A number with more digits than the format has room for keeps them all:
    // `0` on 1234 is 1234, not 4.
    let body = if spaced.is_empty() {
        String::new()
    } else if counts.grouped {
        group_thousands(&spaced)
    } else {
        spaced
    };

    // The sign belongs to whoever chose the section: a negative section was
    // handed the value without one, because the section is what the sign
    // looks like — often brackets rather than a dash.
    assemble(tokens, &body, &kept, scaled < 0.0 && !signed)
}

fn pad_start(text: &str, length: usize, with: char) -> String {
    let have = text.chars().count();
    if have >= length {
        return text.to_string();
    }

    let mut out: String = std::iter::repeat(with).take(length - have).collect();
    out.push_str(text);
    out
}

/// The digit placeholders of a run of tokens, in the order they are written.
fn placeholders_of(tokens: &[Token]) -> Vec<char> {
    tokens
        .iter()
        .filter_map(|token| match token {
            Token::Digit(place) => Some(*place),
            _ => None,
        })
        .collect()
}

/// Digits laid into placeholders that there are too many of.
///
/// The digits are right-aligned and the places left over on the left are what
/// the placeholder says an absent digit looks like: `0` writes a zero, `?`
/// writes a space to line the column up, and `#` writes nothing at all. A
/// thousands separator that falls in the empty part goes the same way as the
/// digit beside it — `?,??????` on six digits is two spaces and then the
/// number, not a space and a stranded comma.
fn laid_out(digits: &str, places: &[char], grouped: bool) -> String {
    let blanks = places.len().saturating_sub(digits.chars().count());
    let padded = pad_start(digits, places.len(), '0');
    let characters: Vec<char> = padded.chars().collect();

    /// What an empty place is written as, which is the whole of the difference.
    fn blank(places: &[char], at: usize, character: char) -> String {
        match places.get(at) {
            Some('0') => character.to_string(),
            Some('?') => " ".to_string(),
            _ => String::new(),
        }
    }

    let mut text = String::new();

    for (at, character) in characters.iter().enumerate() {
        // A separator stands before every third digit counted from the right,
        // and goes the way the place to its left went: kept beside a zero, a
        // space beside a `?`, gone beside a `#`.
        if grouped && at > 0 && (characters.len() - at) % 3 == 0 {
            if at - 1 < blanks {
                text.push_str(&blank(places, at - 1, ','));
            } else {
                text.push(',');
            }
        }

        if at < blanks {
            text.push_str(&blank(places, at, *character));
        } else {
            text.push(*character);
        }
    }

    text
}

/// The places after the point, cut where the format stops asking for them.
///
/// A `0` holds its place whatever the digit is; past the last of them a `#`
/// drops a trailing zero and a `?` turns it into a space.
fn decimals_laid_out(digits: &str, places: &[char]) -> String {
    let significant = digits.trim_end_matches('0').chars().count();
    let required = places
        .iter()
        .rposition(|place| *place == '0')
        .map_or(0, |at| at + 1);
    let kept = significant.max(required);
    let characters: Vec<char> = digits.chars().collect();

    places
        .iter()
        .enumerate()
        .map(|(at, place)| {
            if at < kept {
                characters.get(at).copied().unwrap_or('0').to_string()
            } else if *place == '?' {
                " ".to_string()
            } else if *place == '0' {
                "0".to_string()
            } else {
                String::new()
            }
        })
        .collect()
}

/// The power of ten a mantissa is written against.
///
/// Not always the one that leaves a single digit before the point. The
/// exponent steps by however many integer placeholders the format has, so
/// `##0.0E+0` counts in thousands the way an engineer writes them and
/// `####.####e+#` counts in ten-thousands. One placeholder gives the ordinary
/// kind, which is why the rule is invisible until somebody writes two.
fn exponent_for(magnitude: f64, step: i32) -> i32 {
    if magnitude == 0.0 {
        return 0;
    }

    // Read off the written form rather than `log10`, which answers
    // 2.9999999999999996 for a thousand and would put the point in the wrong
    // place once in a while.
    let written = format!("{:e}", magnitude);
    let power: i32 = written
        .split_once('e')
        .and_then(|(_, power)| power.parse().ok())
        .unwrap_or(0);

    step * power.div_euclid(step)
}

/// A magnitude divided by a power of ten, in two steps where one would overflow.
fn shifted(magnitude: f64, exponent: i32) -> f64 {
    if exponent.abs() <= 300 {
        return magnitude / 10_f64.powi(exponent);
    }

    let half = exponent / 2;
    magnitude / 10_f64.powi(half) / 10_f64.powi(exponent - half)
}

/// A number in the shape `0.00E+00` asks for.
///
/// Everything about it is counted from the format rather than from the
/// number: how many digits stand before the point, how many after, how wide
/// the exponent is, and — the part that is easy to miss — how far the
/// exponent moves at a time. Four integer placeholders mean the exponent is a
/// multiple of four, so 123456.789 through `####.####e+#` is 12.3457e+4
/// rather than 1.2346e+5.
///
/// Written by walking the tokens, because everything between them belongs to
/// the answer: `#%e+#` shows a per-cent sign that multiplies nothing, `#e+#,`
/// shows a comma that divides nothing, and a format that puts its own
/// punctuation around the exponent keeps it.
fn scientific(value: f64, section: &Section) -> String {
    let tokens = &section.tokens;
    let at = tokens
        .iter()
        .position(|token| matches!(token, Token::Exponent { .. }))
        .unwrap_or(0);

    let mantissa_tokens = &tokens[..at];
    let exponent_tokens = &tokens[at + 1..];

    let point = mantissa_tokens
        .iter()
        .position(|token| *token == Token::Decimal);
    let integer_places = placeholders_of(match point {
        Some(place) => &mantissa_tokens[..place],
        None => mantissa_tokens,
    });
    let decimal_places = match point {
        Some(place) => placeholders_of(&mantissa_tokens[place + 1..]),
        None => Vec::new(),
    };
    let exponent_places = placeholders_of(exponent_tokens);

    let magnitude = value.abs();
    let step = integer_places.len().max(1) as i32;
    let exponent = exponent_for(magnitude, step);
    let (whole, fraction) = digits_of(shifted(magnitude, exponent), decimal_places.len());

    let grouped = tokens.contains(&Token::Group);

    // Zero has no digits to lay out, and Excel fills every place it was given
    // rather than leaving them blank: `####.####e+#` shows `0000.e+0`.
    let integer_text = if magnitude == 0.0 {
        laid_out(&"0".repeat(step as usize), &integer_places, grouped)
    } else {
        laid_out(&whole, &integer_places, grouped)
    };

    let (plus, letter) = match tokens.get(at) {
        Some(Token::Exponent { plus, letter }) => (*plus, *letter),
        _ => (false, 'E'),
    };
    let sign = if exponent < 0 {
        "-"
    } else if plus {
        "+"
    } else {
        ""
    };

    let mut body = String::new();
    let mut written = false;

    for token in mantissa_tokens {
        match token {
            Token::Digit(_) => {
                if !written {
                    body.push_str(&integer_text);
                    written = true;
                }
            }
            Token::Decimal => {
                if !written {
                    body.push_str(&integer_text);
                    written = true;
                }
                // The point stands whether or not anything follows it:
                // `#.#e+#` on nothing is `0.e+0`, which looks like a typo and
                // is not one.
                body.push('.');
                body.push_str(&decimals_laid_out(&fraction, &decimal_places));
            }
            Token::Literal(text) => body.push_str(text),
            Token::Pad(_) => body.push(' '),
            Token::Percent => body.push('%'),
            _ => {}
        }
    }

    if !written {
        body.push_str(&integer_text);
    }

    let digits = laid_out(&exponent.abs().to_string(), &exponent_places, false);
    let mut tail = String::new();
    let mut placed = false;

    for token in exponent_tokens {
        match token {
            Token::Digit(_) => {
                if !placed {
                    // The sign belongs to the digits rather than to the
                    // letter: a format that puts something of its own between
                    // the two — `e+|#|` — writes it as `e|+5`.
                    tail.push_str(sign);
                    tail.push_str(&digits);
                    placed = true;
                }
            }
            Token::Literal(text) => tail.push_str(text),
            Token::Pad(_) => tail.push(' '),
            Token::Percent => tail.push('%'),
            _ => {}
        }
    }

    if !placed {
        tail.push_str(sign);
        tail.push_str(&digits);
    }

    format!("{}{body}{letter}{tail}", if value < 0.0 { "-" } else { "" })
}

/// The shortest fraction within the denominator the format allows.
///
/// Walked rather than solved: the denominators are at most three digits, and
/// a continued fraction here would be a clever way to get the same answer.
fn fraction_of(value: f64, denominator_digits: usize, fixed: Option<i64>) -> (i64, i64, i64) {
    let whole = value.trunc() as i64;
    let rest = (value - value.trunc()).abs();

    if let Some(fixed) = fixed {
        return (whole, (rest * fixed as f64).round() as i64, fixed);
    }

    let limit = 10_i64.pow(denominator_digits as u32) - 1;
    let mut best = (0_i64, 1_i64, rest);

    for denominator in 1..=limit {
        let numerator = (rest * denominator as f64).round() as i64;
        let error = (rest - numerator as f64 / denominator as f64).abs();
        if error < best.2 - 1e-12 {
            best = (numerator, denominator, error);
        }
    }

    (whole, best.0, best.1)
}

/// Digits laid one to a place, for a format that puts something between them.
///
/// `laid_out` answers with a string because the places it fills are next to
/// each other. A fraction's are not: `#-#-#\:#/#` has literals in among the
/// whole number's places, and each one has to be written where the format put
/// it. So this answers per place instead — the same right-aligned digits, the
/// same blanks, handed back one at a time.
fn place_text(digits: &str, places: &[char]) -> Vec<String> {
    let length = digits.chars().count();
    let blanks = places.len().saturating_sub(length);
    let spare = length.saturating_sub(places.len());
    let padded: Vec<char> = pad_start(digits, places.len(), '0').chars().collect();

    places
        .iter()
        .enumerate()
        .map(|(at, place)| {
            // A number with more digits than the format has room for keeps
            // them all, and they pile up in the first place rather than being
            // cut off.
            let character: String = if at == 0 {
                padded.iter().take(spare + 1).collect()
            } else {
                padded.get(at + spare).copied().unwrap_or('0').to_string()
            };

            if at >= blanks {
                character
            } else {
                match place {
                    '0' => character,
                    '?' => " ".to_string(),
                    _ => String::new(),
                }
            }
        })
        .collect()
}

/// The shape a fraction format is in.
///
/// Three runs of places and whatever the format wove between them: the whole
/// number, the numerator, the denominator. Which is which falls out of where
/// the stroke is — the numerator is the run of places nearest it on the left,
/// the denominator the run nearest on the right, and anything further left
/// again is the whole number. `#\:#=/=#` puts an equals sign on either side
/// of the stroke, and the run is still the run.
struct Shape {
    whole: Vec<usize>,
    numerator: Vec<usize>,
    denominator: Vec<usize>,
    stroke: usize,
}

fn fraction_shape(tokens: &[Token]) -> Shape {
    let stroke = tokens
        .iter()
        .position(|token| *token == Token::Fraction)
        .unwrap_or(0);
    let digit = |at: usize| matches!(tokens.get(at), Some(Token::Digit(_)));

    let mut left = stroke as i64 - 1;
    while left >= 0 && !digit(left as usize) {
        left -= 1;
    }
    let mut numerator = Vec::new();
    while left >= 0 && digit(left as usize) {
        numerator.insert(0, left as usize);
        left -= 1;
    }

    let mut right = stroke + 1;
    while right < tokens.len() && !digit(right) {
        right += 1;
    }
    let mut denominator = Vec::new();
    while right < tokens.len() && digit(right) {
        denominator.push(right);
        right += 1;
    }

    let limit = numerator.first().copied().unwrap_or(stroke);
    let whole = (0..limit).filter(|at| digit(*at)).collect();

    Shape {
        whole,
        numerator,
        denominator,
        stroke,
    }
}

/// The places of a run of token positions.
fn places_at(tokens: &[Token], where_: &[usize]) -> Vec<char> {
    where_
        .iter()
        .map(|at| match tokens.get(*at) {
            Some(Token::Digit(place)) => *place,
            _ => '#',
        })
        .collect()
}

/// How wide a token is on the page, for a part dropped but holding its place.
fn width_of(token: &Token) -> usize {
    match token {
        Token::Literal(text) => text.chars().count(),
        Token::Digit(_) | Token::Decimal | Token::Fraction | Token::Percent | Token::Pad(_) => 1,
        _ => 0,
    }
}

/// A number as a fraction, the way a format asks for one.
///
/// Three shapes, and they mean different things:
///
/// - `# ?/?` — a whole part and a fraction beside it: 1.25 is `1 1/4`;
/// - `?/?` — no whole part, so the fraction carries all of it: 1.25 is `5/4`;
/// - `?/16` — the denominator is stated, and the numerator is whatever comes
///   nearest: 0.3 is `5/16`.
///
/// What makes this harder than it looks is that either half can be absent and
/// the format still has to read as a number. A whole number with nothing left
/// over drops its fraction — `# ?/?` on three is `3`, not `3 0/1` — and a
/// value under one drops its whole number. Whatever the format put *between*
/// them goes with it, which is why `#\:#/#` on three quarters is `3/4` and
/// not `:3/4`, while the dashes of `#-#-#\:#/#` stay where they are: they are
/// inside the whole number rather than between the two halves.
///
/// Unless the format asked for `?` somewhere. `?` is a space where there is
/// no digit, and a format that asks for one is asking for a column that lines
/// up, so a part dropped out of such a format leaves its own width behind in
/// spaces. `?\:?=/=?` on one is `1` followed by six of them.
fn fractional(value: f64, section: &Section) -> String {
    let tokens = &section.tokens;
    let shape = fraction_shape(tokens);

    let whole_places = places_at(tokens, &shape.whole);
    let numerator_places = places_at(tokens, &shape.numerator);
    let denominator_places = places_at(tokens, &shape.denominator);

    // A denominator written out rather than asked for: `?/16` fixes it at
    // sixteenths however badly they fit.
    let stated: String = tokens[shape.stroke + 1..]
        .iter()
        .filter_map(|token| match token {
            Token::Literal(text) => Some(text.clone()),
            _ => None,
        })
        .collect();
    let fixed = if denominator_places.is_empty()
        && !stated.is_empty()
        && stated.chars().all(|letter| letter.is_ascii_digit())
    {
        stated.parse::<i64>().ok()
    } else {
        None
    };

    let magnitude = value.abs();
    let carries = !whole_places.is_empty();
    let whole = if carries { magnitude.trunc() } else { 0.0 };
    let (_, found, denominator) =
        fraction_of(magnitude - whole, denominator_places.len().max(1), fixed);
    let denominator = fixed.unwrap_or(denominator);
    // With no whole number to carry it, the fraction carries the lot: 3.75
    // through `#/#` is fifteen quarters.
    let numerator = if carries {
        found
    } else {
        (magnitude * denominator as f64).round() as i64
    };

    // A `0` is a digit whether or not there is one to show, so a numerator
    // spelled with one keeps the fraction alive where a `#` would let it go.
    // The denominator has no say in it: `#\:#=/=0` on one is `1`.
    let shows_fraction = !carries || numerator != 0 || numerator_places.contains(&'0');

    // A whole number of nothing is not written beside a fraction — three
    // quarters is `3/4`, not `0 3/4` — but it is written when there is no
    // fraction to write instead, because something has to stand for the value.
    let whole_digits = if !carries || (shows_fraction && magnitude != 0.0 && whole == 0.0) {
        String::new()
    } else {
        format!("{}", whole as i64)
    };

    // A zero with nowhere but `#` to go is the one place the placeholders
    // differ about zero: `#` shows nothing, `?` and `0` show the digit.
    let hides =
        shows_fraction && whole_digits == "0" && whole_places.iter().all(|place| *place == '#');

    // A part dropped out of a format that asked for columns holds its width
    // in spaces, so the numbers under it still line up. Which `?` counts
    // depends on which part went: what stood between the two halves lines up
    // with the halves beside it, and a fraction that is not written lines up
    // with the fraction that would have been.
    let asks = |places: &[char]| places.contains(&'?');
    let holds_separator = asks(&whole_places) || asks(&numerator_places);
    let holds_fraction =
        asks(&whole_places) || asks(&numerator_places) || asks(&denominator_places);

    let whole_text = place_text(if hides { "" } else { &whole_digits }, &whole_places);
    let numerator_text = place_text(&numerator.to_string(), &numerator_places);
    let denominator_text = place_text(&denominator.to_string(), &denominator_places);

    // What stands between the two halves belongs to whichever of them wrote
    // something; a column of spaces is not something.
    let shows_whole = whole_text.concat().trim() != "";

    let opens = shape.numerator.first().copied().unwrap_or(shape.stroke);
    let closes = shape.denominator.last().copied().unwrap_or(shape.stroke);
    let whole_ends = shape.whole.last().map(|at| *at as i64).unwrap_or(-1);

    let mut text = String::new();

    for (at, token) in tokens.iter().enumerate() {
        let between = carries && at as i64 > whole_ends && at < opens;
        let in_fraction = at >= opens && at <= closes;

        let dropped = if !shows_fraction {
            if between || in_fraction {
                Some(holds_fraction)
            } else {
                None
            }
        } else if between && !shows_whole {
            Some(holds_separator)
        } else {
            None
        };

        if let Some(holds) = dropped {
            if holds {
                text.push_str(&" ".repeat(width_of(token)));
            }
            continue;
        }

        match token {
            Token::Digit(_) => {
                let written = if let Some(where_) = shape.whole.iter().position(|one| *one == at) {
                    whole_text.get(where_).cloned().unwrap_or_default()
                } else if let Some(where_) = shape.numerator.iter().position(|one| *one == at) {
                    numerator_text.get(where_).cloned().unwrap_or_default()
                } else if let Some(where_) = shape.denominator.iter().position(|one| *one == at) {
                    denominator_text.get(where_).cloned().unwrap_or_default()
                } else {
                    String::new()
                };
                text.push_str(&written);
            }
            Token::Fraction => text.push('/'),
            Token::Literal(written) => text.push_str(written),
            Token::Pad(_) => text.push(' '),
            Token::Percent => text.push('%'),
            _ => {}
        }
    }

    format!("{}{text}", if value < 0.0 { "-" } else { "" })
}

/// Puts the digits back among the literals the format states.
fn assemble(tokens: &[Token], whole: &str, decimals: &str, negative: bool) -> String {
    let mut written = false;
    let mut text = String::new();

    for token in tokens {
        match token {
            Token::Digit(_) | Token::Group => {
                if !written {
                    text.push_str(whole);
                    written = true;
                }
            }
            Token::Decimal => {
                if !written {
                    text.push_str(whole);
                    written = true;
                }
                if !decimals.is_empty() {
                    text.push('.');
                    text.push_str(decimals);
                }
            }
            Token::Literal(written_text) => text.push_str(written_text),
            Token::Pad(_) => text.push(' '),
            Token::Percent => text.push('%'),
            _ => {}
        }
    }

    if !written && !whole.is_empty() {
        text.push_str(whole);
    }

    format!("{}{text}", if negative { "-" } else { "" })
}

fn format_text(value: &str, section: Option<&Section>) -> String {
    let Some(section) = section else {
        return value.to_string();
    };

    section
        .tokens
        .iter()
        .map(|token| match token {
            Token::Text => value.to_string(),
            Token::Literal(text) => text.clone(),
            Token::Pad(_) => " ".to_string(),
            _ => String::new(),
        })
        .collect()
}
