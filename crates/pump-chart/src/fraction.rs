use std::cmp::Ordering;

use crate::{Fraction, FractionError};

pub(crate) const fn gcd(mut left: u128, mut right: u128) -> u128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

pub(crate) fn reduce(numerator: u128, denominator: u128) -> Result<Fraction, FractionError> {
    if denominator == 0 {
        return Err(FractionError::ZeroDenominator);
    }
    let divisor = gcd(numerator, denominator);
    Ok(Fraction {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    })
}

pub(crate) fn checked_add(left: Fraction, right: Fraction) -> Result<Fraction, FractionError> {
    let divisor = gcd(left.denominator, right.denominator);
    let left_scale = right.denominator / divisor;
    let right_scale = left.denominator / divisor;
    let numerator = left
        .numerator
        .checked_mul(left_scale)
        .and_then(|value| {
            right
                .numerator
                .checked_mul(right_scale)
                .and_then(|other| value.checked_add(other))
        })
        .ok_or(FractionError::Overflow)?;
    let denominator = left
        .denominator
        .checked_mul(left_scale)
        .ok_or(FractionError::Overflow)?;
    reduce(numerator, denominator)
}

pub(crate) fn checked_mul(left: Fraction, right: Fraction) -> Result<Fraction, FractionError> {
    let left_divisor = gcd(left.numerator, right.denominator);
    let right_divisor = gcd(right.numerator, left.denominator);
    let numerator = (left.numerator / left_divisor)
        .checked_mul(right.numerator / right_divisor)
        .ok_or(FractionError::Overflow)?;
    let denominator = (left.denominator / right_divisor)
        .checked_mul(right.denominator / left_divisor)
        .ok_or(FractionError::Overflow)?;
    reduce(numerator, denominator)
}

pub(crate) fn checked_sub(left: Fraction, right: Fraction) -> Result<Fraction, FractionError> {
    let divisor = gcd(left.denominator, right.denominator);
    let left_scale = right.denominator / divisor;
    let right_scale = left.denominator / divisor;
    let left_numerator = left
        .numerator
        .checked_mul(left_scale)
        .ok_or(FractionError::Overflow)?;
    let right_numerator = right
        .numerator
        .checked_mul(right_scale)
        .ok_or(FractionError::Overflow)?;
    let numerator = left_numerator
        .checked_sub(right_numerator)
        .ok_or(FractionError::Overflow)?;
    let denominator = left
        .denominator
        .checked_mul(left_scale)
        .ok_or(FractionError::Overflow)?;
    reduce(numerator, denominator)
}

pub(crate) fn checked_div(left: Fraction, right: Fraction) -> Result<Fraction, FractionError> {
    if right.numerator == 0 {
        return Err(FractionError::DivisionByZero);
    }
    checked_mul(
        left,
        Fraction {
            numerator: right.denominator,
            denominator: right.numerator,
        },
    )
}

pub(crate) fn compare(left: Fraction, right: Fraction) -> Ordering {
    let mut left_numerator = left.numerator;
    let mut left_denominator = left.denominator;
    let mut right_numerator = right.numerator;
    let mut right_denominator = right.denominator;
    let mut reversed = false;
    loop {
        let left_whole = left_numerator / left_denominator;
        let right_whole = right_numerator / right_denominator;
        match left_whole.cmp(&right_whole) {
            Ordering::Equal => {}
            ordering @ (Ordering::Less | Ordering::Greater) => {
                return if reversed {
                    ordering.reverse()
                } else {
                    ordering
                };
            }
        }
        let left_remainder = left_numerator % left_denominator;
        let right_remainder = right_numerator % right_denominator;
        match (left_remainder == 0, right_remainder == 0) {
            (true, true) => return Ordering::Equal,
            (true, false) => {
                return if reversed {
                    Ordering::Greater
                } else {
                    Ordering::Less
                };
            }
            (false, true) => {
                return if reversed {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
            (false, false) => {
                left_numerator = left_denominator;
                left_denominator = left_remainder;
                right_numerator = right_denominator;
                right_denominator = right_remainder;
                reversed = !reversed;
            }
        }
    }
}
