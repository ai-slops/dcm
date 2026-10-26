use crate::UcsError;

pub(crate) const JS_SAFE: u128 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Decimal {
    pub numerator: u128,
    pub denominator: u128,
}

pub(crate) fn parse_unsigned(value: &str, line: usize, places: usize) -> Result<Decimal, UcsError> {
    if value.is_empty() || value.starts_with(['+', '-']) {
        return Err(UcsError::malformed(line, "expected an unsigned decimal"));
    }
    let (whole, fraction) = value.split_once('.').map_or((value, ""), |parts| parts);
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.len() > places
        || (value.contains('.') && fraction.is_empty())
    {
        return Err(UcsError::unsupported(
            line,
            "decimal precision is unsupported",
        ));
    }
    let denominator = pow10(fraction.len())?;
    let whole = whole.parse::<u128>().map_err(|_| UcsError::Overflow)?;
    let tail = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<u128>().map_err(|_| UcsError::Overflow)?
    };
    let numerator = whole
        .checked_mul(denominator)
        .and_then(|scaled| scaled.checked_add(tail))
        .ok_or(UcsError::Overflow)?;
    let divisor = gcd(numerator, denominator);
    Ok(Decimal {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    })
}

pub(crate) fn parse_signed_micros(value: &str, line: usize) -> Result<i64, UcsError> {
    let (negative, magnitude) = match value.as_bytes().first() {
        Some(b'-') => (true, &value[1..]),
        Some(b'+') => (false, &value[1..]),
        Some(_) => (false, value),
        None => return Err(UcsError::malformed(line, "expected a signed decimal")),
    };
    if magnitude.starts_with(['+', '-']) {
        return Err(UcsError::malformed(line, "Delay has more than one sign"));
    }
    let decimal = parse_unsigned(magnitude, line, 3)?;
    let scaled = decimal
        .numerator
        .checked_mul(1_000)
        .ok_or(UcsError::Overflow)?;
    if scaled % decimal.denominator != 0 {
        return Err(UcsError::unsupported(
            line,
            "Delay must resolve to whole microseconds",
        ));
    }
    let micros = scaled / decimal.denominator;
    if micros > JS_SAFE {
        return Err(UcsError::Limit("JavaScript-safe offset"));
    }
    let signed = i64::try_from(micros).map_err(|_| UcsError::Overflow)?;
    Ok(if negative { -signed } else { signed })
}

pub(crate) fn format_decimal(
    numerator: u128,
    denominator: u128,
    max_places: usize,
) -> Result<String, UcsError> {
    if denominator == 0 {
        return Err(UcsError::Overflow);
    }
    let divisor = gcd(numerator, denominator);
    let numerator = numerator / divisor;
    let mut remainder_denominator = denominator / divisor;
    let mut twos = 0_usize;
    let mut fives = 0_usize;
    while remainder_denominator.is_multiple_of(2) {
        remainder_denominator /= 2;
        twos += 1;
    }
    while remainder_denominator.is_multiple_of(5) {
        remainder_denominator /= 5;
        fives += 1;
    }
    let places = twos.max(fives);
    if remainder_denominator != 1 || places > max_places {
        return Err(UcsError::Unrepresentable(
            "decimal needs more than the supported precision",
        ));
    }
    let scale = pow10(places)?;
    let scaled = numerator.checked_mul(scale).ok_or(UcsError::Overflow)? / (denominator / divisor);
    let whole = scaled / scale;
    if places == 0 {
        return Ok(whole.to_string());
    }
    let mut fraction = format!("{:0places$}", scaled % scale);
    while fraction.ends_with('0') {
        fraction.pop();
    }
    if fraction.is_empty() {
        Ok(whole.to_string())
    } else {
        Ok(format!("{whole}.{fraction}"))
    }
}

pub(crate) const fn gcd(mut left: u128, mut right: u128) -> u128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

pub(crate) fn lcm(left: u32, right: u32) -> Result<u32, UcsError> {
    let divisor =
        u32::try_from(gcd(u128::from(left), u128::from(right))).map_err(|_| UcsError::Overflow)?;
    left.checked_div(divisor)
        .and_then(|value| value.checked_mul(right))
        .ok_or(UcsError::Overflow)
}

fn pow10(places: usize) -> Result<u128, UcsError> {
    (0..places).try_fold(1_u128, |value, _| {
        value.checked_mul(10).ok_or(UcsError::Overflow)
    })
}
