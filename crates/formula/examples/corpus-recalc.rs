//! Works a workbook out from the outside, for the corpus run.
//!
//! The engine is a library with no idea what a file is, and the corpus scripts
//! are TypeScript that can read one but cannot call Rust. This is the seam
//! between them and nothing else: cells in on stdin, values out on stdout.
//!
//! It is an example rather than a binary on purpose — nothing ships it, and
//! the crate stays a library with no dependencies.
//!
//! The protocol is one record a line, tab separated, because the alternative
//! is a serialisation dependency for four kinds of record:
//!
//! ```text
//! moment    <serial>
//! date1904  <0|1>
//! name      <name>     <formula>
//! table     <name>     <sheet>  <top>  <bottom>  <left>  <right>  <headers>  <totals>  <column>…
//! value     <sheet>    <row>  <column>  <n|s|b|e|blank>  <payload>
//! formula   <sheet>    <row>  <column>  <text>  <cached kind>  <cached payload>  <array>
//! recalc
//! get       <sheet>    <row>  <column>
//! ```
//!
//! Rows and columns are zero-based, as they are across the engine's own API.
//! `get` prints `<kind>\t<payload>`; everything else prints nothing. Tabs,
//! newlines and backslashes inside a payload are escaped `\t`, `\n`, `\\`.

use std::io::{self, BufWriter, Read, Write};

use formula::{DateSystem, Engine, Error, Table, Value};

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars();

    while let Some(character) = characters.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }

        match characters.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('\\') => out.push('\\'),
            Some(other) => out.push(other),
            None => {}
        }
    }

    out
}

fn escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\n', "\\n")
}

fn error_of(text: &str) -> Error {
    match text {
        "#NULL!" => Error::Null,
        "#DIV/0!" => Error::DivideByZero,
        "#REF!" => Error::Reference,
        "#NAME?" => Error::Name,
        "#NUM!" => Error::Number,
        "#N/A" => Error::NotAvailable,
        "#SPILL!" => Error::Spill,
        "#CALC!" => Error::Calc,
        _ => Error::Value,
    }
}

fn value_of(kind: &str, payload: &str) -> Value {
    match kind {
        "n" => Value::Number(payload.parse().unwrap_or(0.0)),
        "s" => Value::Text(unescape(payload)),
        "b" => Value::Bool(payload == "1" || payload.eq_ignore_ascii_case("true")),
        "e" => Value::Error(error_of(payload)),
        _ => Value::Blank,
    }
}

/// The value as the other side will compare it: kind, then payload.
fn printed(value: &Value) -> (char, String) {
    match value {
        Value::Number(number) => ('n', format!("{number}")),
        Value::Text(text) => ('s', escape(text)),
        Value::Bool(yes) => ('b', if *yes { "1".into() } else { "0".into() }),
        Value::Error(error) => ('e', error.text().to_string()),
        Value::Blank => ('z', String::new()),
        // A cell holding an array shows its top-left corner, which is what a
        // reader of the file sees in the cell the formula is in.
        Value::Array(array) => match array.values.first() {
            Some(first) => printed(first),
            None => ('z', String::new()),
        },
    }
}

fn main() {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .expect("stdin is readable");

    let mut engine = Engine::new();
    let mut tables: Vec<Table> = Vec::new();
    let output = io::stdout();
    let mut out = BufWriter::new(output.lock());

    for line in input.lines() {
        let mut fields = line.split('\t');
        let Some(record) = fields.next() else {
            continue;
        };

        match record {
            "moment" => {
                if let Some(serial) = fields.next().and_then(|text| text.parse().ok()) {
                    engine.set_moment(serial);
                }
            }
            "date1904" => {
                let system = if fields.next() == Some("1") {
                    DateSystem::Excel1904
                } else {
                    DateSystem::Excel1900
                };
                engine.set_date_system(system);
            }
            "name" => {
                if let (Some(name), Some(text)) = (fields.next(), fields.next()) {
                    engine.set_name(&unescape(name), &unescape(text));
                }
            }
            "value" => {
                let sheet = unescape(fields.next().unwrap_or_default());
                let row: i64 = fields.next().unwrap_or("0").parse().unwrap_or(0);
                let column: i64 = fields.next().unwrap_or("0").parse().unwrap_or(0);
                let kind = fields.next().unwrap_or("z");
                let payload = fields.next().unwrap_or_default();
                engine.load_value(&sheet, row, column, value_of(kind, payload));
            }
            "formula" => {
                let sheet = unescape(fields.next().unwrap_or_default());
                let row: i64 = fields.next().unwrap_or("0").parse().unwrap_or(0);
                let column: i64 = fields.next().unwrap_or("0").parse().unwrap_or(0);
                let text = unescape(fields.next().unwrap_or_default());
                let kind = fields.next().unwrap_or("z");
                let payload = fields.next().unwrap_or_default();
                // Whether the cell said `t="array"` or carried `cm="1"`, which
                // is what decides implicit intersection.
                let array = fields.next() == Some("1");

                let cached = value_of(kind, payload);
                let loaded = if array {
                    engine.load_array_formula(&sheet, row, column, &text, cached.clone())
                } else {
                    engine.load_formula(&sheet, row, column, &text, cached.clone())
                };

                // A formula the parser will not take is not an error here: the
                // question the run asks is what the engine makes of the ones it
                // does take, and a cell it cannot read keeps the file's value.
                if loaded.is_err() {
                    engine.load_value(&sheet, row, column, value_of(kind, payload));
                    let _ = writeln!(out, "unparsed\t{}\t{row}\t{column}", escape(&sheet));
                }
            }
            "table" => {
                let mut next = || fields.next().unwrap_or_default().to_string();
                let name = unescape(&next());
                let sheet = unescape(&next());
                let numbers: Vec<i64> = (0..6).map(|_| next().parse().unwrap_or(0)).collect();
                let columns: Vec<String> = fields.map(unescape).collect();

                tables.push(Table {
                    name,
                    sheet,
                    top: numbers[0],
                    bottom: numbers[1],
                    left: numbers[2],
                    right: numbers[3],
                    header_rows: numbers[4],
                    totals_rows: numbers[5],
                    columns,
                });
            }
            "recalc" => {
                // Told once, at the end: a structured reference is resolved
                // against the tables as they stand when the sheet is worked
                // out, not as they stood when the formula arrived.
                engine.set_tables(tables.clone());
                engine.recalculate();
            }
            "get" => {
                let sheet = unescape(fields.next().unwrap_or_default());
                let row: i64 = fields.next().unwrap_or("0").parse().unwrap_or(0);
                let column: i64 = fields.next().unwrap_or("0").parse().unwrap_or(0);
                let (kind, payload) = printed(&engine.value(&sheet, row, column));
                let _ = writeln!(out, "{kind}\t{payload}");
            }
            _ => {}
        }
    }

    let _ = out.flush();
}
