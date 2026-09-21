//! A hasher for keys the engine makes up itself.
//!
//! The standard library hashes with SipHash, which is chosen to be hard to
//! attack: a map whose keys come from outside must not be turnable into a
//! linked list by somebody who knows how it hashes. None of these keys come
//! from outside — a cell is a sheet name and two numbers that this program
//! made up — and a recalculation of a million formulas hashes several million
//! of them, where the difference between a careful hash and a quick one is
//! about a second.
//!
//! This is the multiply-and-rotate hash rustc uses on its own maps, for the
//! same reason and with the same trade: fast, good enough for keys nobody is
//! choosing adversarially, and fifteen lines long.

use std::hash::{BuildHasherDefault, Hasher};

/// A map keyed by something this program made up.
pub type FastMap<K, V> = std::collections::HashMap<K, V, BuildHasherDefault<Fast>>;

/// A set of the same.
pub type FastSet<K> = std::collections::HashSet<K, BuildHasherDefault<Fast>>;

const SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;

#[derive(Default)]
pub struct Fast(u64);

impl Fast {
    #[inline]
    fn take(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(SEED);
    }
}

impl Hasher for Fast {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        // Eight at a time, because a sheet name is a handful of characters
        // and doing them one by one is most of the cost of hashing one.
        let mut rest = bytes;
        while rest.len() >= 8 {
            let (word, left) = rest.split_at(8);
            self.take(u64::from_le_bytes(word.try_into().unwrap_or([0; 8])));
            rest = left;
        }

        let mut tail = 0u64;
        for (at, byte) in rest.iter().enumerate() {
            tail |= u64::from(*byte) << (at * 8);
        }
        self.take(tail);
    }

    #[inline]
    fn write_u64(&mut self, value: u64) {
        self.take(value);
    }

    #[inline]
    fn write_i64(&mut self, value: i64) {
        self.take(value as u64);
    }

    #[inline]
    fn write_usize(&mut self, value: usize) {
        self.take(value as u64);
    }

    #[inline]
    fn write_u8(&mut self, value: u8) {
        self.take(u64::from(value));
    }

    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}
