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

/// `General` — the format a cell has when it has none.
///
/// Excel fits the number into about eleven characters: plain where it can,
/// scientific where the number is too big or too small to show otherwise. The
/// exact rule involves the column's width, which nothing here knows, so this
/// is the width-independent part of it.
pub fn format_general(value: f64) -> String {
    if !value.is_finite() {
        return "#NUM!".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }

    let magnitude = value.abs();
    if !(1e-10..1e11).contains(&magnitude) {
        let written = format!("{:E}", value);
        let (mantissa, power) = written.split_once('E').unwrap_or((written.as_str(), "0"));
        let trimmed = trim_zeros(mantissa);
        let exponent: i32 = power.parse().unwrap_or(0);

        return format!(
            "{trimmed}E{}{:02}",
            if exponent < 0 { '-' } else { '+' },
            exponent.abs()
        );
    }

    // Eleven significant digits, with the trailing zeros a rounding leaves.
    let places = (10 - magnitude.log10().floor() as i32).clamp(0, 17);
    trim_zeros(&format!("{:.*}", places as usize, value))
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

    let percent = tokens
        .iter()
        .filter(|token| **token == Token::Percent)
        .count();
    let scale = tokens.iter().fold(1.0, |by, token| match token {
        Token::Scale(each) => by * each,
        _ => by,
    });
    let scaled = value * 100_f64.powi(percent as i32) / scale;

    if tokens
        .iter()
        .any(|token| matches!(token, Token::Exponent(_)))
    {
        return scientific(scaled, section);
    }
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

/// A number in the shape `0.00E+00` asks for.
///
/// Two widths, both counted from the format rather than from the number: how
/// many places the mantissa shows, and how many digits the exponent is padded
/// to. `E+` writes the sign of a positive exponent and `E-` leaves it off,
/// which is the only difference between them.
fn scientific(value: f64, section: &Section) -> String {
    let tokens = &section.tokens;
    let at = tokens
        .iter()
        .position(|token| matches!(token, Token::Exponent(_)))
        .unwrap_or(0);

    let point = tokens.iter().position(|token| *token == Token::Decimal);
    let mantissa_decimals = match point {
        Some(place) if place < at => tokens[place + 1..at]
            .iter()
            .filter(|token| matches!(token, Token::Digit(_)))
            .count(),
        _ => 0,
    };

    let width = tokens[at + 1..]
        .iter()
        .filter(|token| matches!(token, Token::Digit(_)))
        .count()
        .max(1);

    let written = format!("{:.*e}", mantissa_decimals, value.abs());
    let (mantissa, power) = written.split_once('e').unwrap_or((written.as_str(), "0"));
    let exponent: i32 = power.parse().unwrap_or(0);

    let sign = if exponent < 0 {
        "-"
    } else if matches!(tokens.get(at), Some(Token::Exponent(true))) {
        "+"
    } else {
        ""
    };

    format!(
        "{}{mantissa}E{sign}{}",
        if value < 0.0 { "-" } else { "" },
        padded(i64::from(exponent.abs()), width)
    )
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

/// A number as a fraction, the way a format asks for one.
///
/// Three shapes, and they mean different things: `# ?/?` has a whole part
/// beside the fraction, `?/?` has none and the fraction carries all of it,
/// and `?/16` states the denominator. Which one it is falls out of where the
/// digits are.
fn fractional(value: f64, section: &Section) -> String {
    let tokens = &section.tokens;
    let stroke = tokens
        .iter()
        .position(|token| *token == Token::Fraction)
        .unwrap_or(0);

    let before = &tokens[..stroke];
    let after = &tokens[stroke + 1..];

    // The numerator's placeholders are the run of digits right before the
    // stroke; anything further left, past a space or another literal, is the
    // whole part.
    let separator = before
        .iter()
        .rposition(|token| matches!(token, Token::Literal(_)));
    let whole_places = match separator {
        None => 0,
        Some(at) => before[..at]
            .iter()
            .filter(|token| matches!(token, Token::Digit(_)))
            .count(),
    };

    let stated: String = after
        .iter()
        .filter_map(|token| match token {
            Token::Literal(text) => Some(text.clone()),
            _ => None,
        })
        .collect();
    let fixed = if !stated.is_empty() && stated.chars().all(|letter| letter.is_ascii_digit()) {
        stated.parse::<i64>().ok()
    } else {
        None
    };

    let denominator_digits = after
        .iter()
        .filter(|token| matches!(token, Token::Digit(_)))
        .count()
        .max(1);

    let (whole, numerator, denominator) = fraction_of(value, denominator_digits, fixed);
    let sign = if value < 0.0 { "-" } else { "" };

    if whole_places == 0 {
        // No whole part: the fraction carries the lot, so 1.25 is five
        // quarters.
        let improper = fixed.unwrap_or(denominator);
        return format!(
            "{sign}{}/{improper}",
            (value.abs() * improper as f64).round() as i64
        );
    }

    if numerator == 0 {
        return format!("{sign}{}", whole.abs());
    }

    let head = if whole == 0 {
        String::new()
    } else {
        format!("{} ", whole.abs())
    };

    format!("{sign}{head}{numerator}/{denominator}")
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
