//! Tokens into a tree.
//!
//! A precedence climb, which is the shortest honest way to parse an expression
//! language: one function for a value, one for the operators that join values,
//! and a table saying how tightly each binds. Excel's precedence is not C's —
//! the comparison operators bind loosely and the reference operators bind
//! tighter than arithmetic — so the table is the specification.
//!
//! What this does not do is decide whether anything is valid. `SUM(1,2,3)`
//! with three arguments and `SUM()` with none both parse; whether a function
//! takes that many is the registry's business, and an unknown function is not
//! an error at all — it parses, and evaluates to `#NAME?`, so that a workbook
//! using something unimplemented is not a workbook this damages.

use crate::ast::{Expr, Operator};
use crate::lexer::{lex, Token, TokenKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub at: usize,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "{} (at {})", self.message, self.at)
    }
}

/// A formula, as a tree. The leading `=` is optional, as it is in the file.
pub fn parse(input: &str) -> Result<Expr, ParseError> {
    let tokens = lex(input).map_err(|message| ParseError { message, at: 0 })?;
    let mut parser = Parser { tokens, at: 0 };

    let expression = parser.expression(0)?;
    parser.skip_spaces();

    match parser.peek() {
        None => Ok(expression),
        Some(token) => Err(ParseError {
            message: "there is more here than one formula".to_string(),
            at: token.at,
        }),
    }
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.at).cloned();
        if token.is_some() {
            self.at += 1;
        }
        token
    }

    fn skip_spaces(&mut self) {
        while matches!(self.peek().map(|token| &token.kind), Some(TokenKind::Space)) {
            self.at += 1;
        }
    }

    /// Whether the space at `at` is the intersection operator.
    ///
    /// It is one only between two things that could be references — `A1 B1` —
    /// and is otherwise the spacing people put around operators. Deciding it
    /// here is what keeps the lexer from needing to know what came before.
    fn space_is_intersection(&self) -> bool {
        let before = self.tokens[..self.at]
            .iter()
            .rev()
            .find(|token| token.kind != TokenKind::Space);
        let after = self.tokens[self.at..]
            .iter()
            .find(|token| token.kind != TokenKind::Space);

        let closes = matches!(
            before.map(|token| &token.kind),
            Some(TokenKind::Reference(_)) | Some(TokenKind::Name(_)) | Some(TokenKind::CloseParen)
        );
        let opens = matches!(
            after.map(|token| &token.kind),
            Some(TokenKind::Reference(_)) | Some(TokenKind::Name(_)) | Some(TokenKind::OpenParen)
        );

        closes && opens
    }

    /// The operator at the cursor, if what is there is one.
    fn operator(&mut self) -> Option<Operator> {
        if matches!(self.peek().map(|token| &token.kind), Some(TokenKind::Space)) {
            return if self.space_is_intersection() {
                Some(Operator::Intersect)
            } else {
                None
            };
        }

        match self.peek().map(|token| &token.kind) {
            Some(TokenKind::Operator(text)) => match text.as_str() {
                "+" => Some(Operator::Add),
                "-" => Some(Operator::Subtract),
                "*" => Some(Operator::Multiply),
                "/" => Some(Operator::Divide),
                "^" => Some(Operator::Power),
                "&" => Some(Operator::Concat),
                "=" => Some(Operator::Equal),
                "<>" => Some(Operator::NotEqual),
                "<" => Some(Operator::Less),
                "<=" => Some(Operator::LessOrEqual),
                ">" => Some(Operator::Greater),
                ">=" => Some(Operator::GreaterOrEqual),
                ":" => Some(Operator::Range),
                _ => None,
            },
            _ => None,
        }
    }

    fn expression(&mut self, least: u8) -> Result<Expr, ParseError> {
        let mut left = self.unary()?;

        loop {
            // Spacing is skipped only once it is known not to be an operator.
            let before = self.at;
            if matches!(self.peek().map(|token| &token.kind), Some(TokenKind::Space))
                && !self.space_is_intersection()
            {
                self.skip_spaces();
            }

            let Some(operator) = self.operator() else {
                self.at = before.max(self.at);
                break;
            };

            if operator.precedence() < least {
                self.at = before;
                break;
            }

            // The intersection is a space; everything else is a token of its own.
            if operator == Operator::Intersect {
                self.skip_spaces();
            } else {
                self.next();
            }

            self.skip_spaces();
            let next = if operator.left_associative() {
                operator.precedence() + 1
            } else {
                operator.precedence()
            };

            let right = self.expression(next)?;
            left = Expr::Binary {
                operator,
                left: Box::new(left),
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn unary(&mut self) -> Result<Expr, ParseError> {
        self.skip_spaces();

        if let Some(TokenKind::Operator(text)) = self.peek().map(|token| token.kind.clone()) {
            if text == "-" || text == "+" {
                self.next();
                // Binds tighter than everything but the power operator, which
                // is why `-2^2` is -4 in Excel as well as in mathematics.
                let operand = self.unary()?;
                return Ok(self.postfix(Expr::Unary {
                    negative: text == "-",
                    operand: Box::new(operand),
                }));
            }
        }

        let value = self.value()?;
        Ok(self.postfix(value))
    }

    /// `%`, which is written after what it applies to.
    fn postfix(&mut self, expression: Expr) -> Expr {
        let mut result = expression;

        while let Some(TokenKind::Operator(text)) = self.peek().map(|token| token.kind.clone()) {
            if text != "%" {
                break;
            }
            self.next();
            result = Expr::Percent(Box::new(result));
        }

        result
    }

    fn value(&mut self) -> Result<Expr, ParseError> {
        self.skip_spaces();

        let Some(token) = self.next() else {
            return Err(ParseError {
                message: "the formula stops early".to_string(),
                at: 0,
            });
        };

        match token.kind {
            TokenKind::Number(value) => Ok(Expr::Number(value)),
            TokenKind::Text(value) => Ok(Expr::Text(value)),
            TokenKind::Bool(value) => Ok(Expr::Bool(value)),
            TokenKind::Error(value) => Ok(Expr::Error(value)),
            TokenKind::Reference(reference) => Ok(Expr::Reference(reference)),

            TokenKind::Name(name) => {
                // A name with a bracket after it is a call; without one it is
                // a defined name, and there is no way to tell them apart
                // earlier than here.
                if matches!(
                    self.peek().map(|token| &token.kind),
                    Some(TokenKind::OpenParen)
                ) {
                    self.next();
                    let arguments = self.arguments()?;
                    return Ok(Expr::Call { name, arguments });
                }

                Ok(Expr::Name(name))
            }

            TokenKind::OpenParen => {
                let inside = self.expression(0)?;
                self.skip_spaces();

                match self.next() {
                    Some(Token {
                        kind: TokenKind::CloseParen,
                        ..
                    }) => Ok(Expr::Parenthesised(Box::new(inside))),
                    _ => Err(ParseError {
                        message: "a bracket that never closes".to_string(),
                        at: token.at,
                    }),
                }
            }

            TokenKind::OpenBrace => self.array(token.at),

            other => Err(ParseError {
                message: format!("{other:?} cannot start a value"),
                at: token.at,
            }),
        }
    }

    /// The arguments of a call, where a missing one is a value of its own.
    fn arguments(&mut self) -> Result<Vec<Expr>, ParseError> {
        let mut arguments: Vec<Expr> = Vec::new();
        self.skip_spaces();

        if matches!(
            self.peek().map(|token| &token.kind),
            Some(TokenKind::CloseParen)
        ) {
            self.next();
            return Ok(arguments);
        }

        loop {
            self.skip_spaces();

            // `IF(A1,,2)`: the gap is an argument, and dropping it would move
            // the ones after it along by one. `SUM(1,)` ends the same way.
            let missing = matches!(
                self.peek().map(|token| &token.kind),
                Some(TokenKind::Comma) | Some(TokenKind::Semicolon) | Some(TokenKind::CloseParen)
            );

            if missing {
                arguments.push(Expr::Blank);
            } else {
                arguments.push(self.expression(0)?);
            }

            self.skip_spaces();
            match self.next() {
                Some(Token {
                    kind: TokenKind::Comma,
                    ..
                })
                | Some(Token {
                    kind: TokenKind::Semicolon,
                    ..
                }) => continue,
                Some(Token {
                    kind: TokenKind::CloseParen,
                    ..
                }) => return Ok(arguments),
                Some(token) => {
                    return Err(ParseError {
                        message: "an argument list that does not close".to_string(),
                        at: token.at,
                    })
                }
                None => {
                    return Err(ParseError {
                        message: "an argument list that does not close".to_string(),
                        at: 0,
                    })
                }
            }
        }
    }

    /// `{1,2;3,4}` — commas between the values of a row, semicolons between rows.
    fn array(&mut self, from: usize) -> Result<Expr, ParseError> {
        let mut rows: Vec<Vec<Expr>> = Vec::new();
        let mut row: Vec<Expr> = Vec::new();

        loop {
            self.skip_spaces();

            if matches!(
                self.peek().map(|token| &token.kind),
                Some(TokenKind::CloseBrace)
            ) {
                self.next();
                rows.push(row);
                return Ok(Expr::Array(rows));
            }

            row.push(self.expression(0)?);
            self.skip_spaces();

            match self.next() {
                Some(Token {
                    kind: TokenKind::Comma,
                    ..
                }) => continue,
                Some(Token {
                    kind: TokenKind::Semicolon,
                    ..
                }) => {
                    rows.push(std::mem::take(&mut row));
                }
                Some(Token {
                    kind: TokenKind::CloseBrace,
                    ..
                }) => {
                    rows.push(row);
                    return Ok(Expr::Array(rows));
                }
                _ => {
                    return Err(ParseError {
                        message: "an array that does not close".to_string(),
                        at: from,
                    })
                }
            }
        }
    }
}
