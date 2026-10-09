use std::fmt::Write as _;

use anyhow::{Context, Result, ensure};
use pump_chart::{Fraction, Music};

const ROWS_PER_BEAT: u128 = 48;
const MAX_DECIMAL_PLACES: u32 = 6;
const MAX_METADATA_BYTES: usize = 256;
const MAX_BEAT: u128 = 1_000_000;
const MAX_BPM: u128 = 1_000;

pub fn row(tick: u64, ticks_per_beat: u32) -> Result<u64> {
    let scaled = u128::from(tick)
        .checked_mul(ROWS_PER_BEAT)
        .context("SSC row overflow")?;
    let divisor = u128::from(ticks_per_beat);
    ensure!(
        scaled % divisor == 0,
        "event is outside the SSC 192-row grid"
    );
    u64::try_from(scaled / divisor).context("SSC row conversion overflow")
}

pub fn bpms(music: &Music) -> Result<String> {
    let mut output = String::new();
    for (index, segment) in music.tempo.iter().enumerate() {
        row(segment.start_tick, music.ticks_per_beat)?;
        let beat = decimal(
            u128::from(segment.start_tick),
            u128::from(music.ticks_per_beat),
            MAX_BEAT,
            "tempo beat",
        )?;
        let bpm_numerator = 60_000_000_u128
            .checked_mul(segment.micros_per_beat.denominator())
            .context("BPM overflow")?;
        let bpm = decimal(
            bpm_numerator,
            segment.micros_per_beat.numerator(),
            MAX_BPM,
            "BPM",
        )?;
        if index > 0 {
            output.push(',');
        }
        write!(output, "{beat}={bpm}")?;
    }
    Ok(output)
}

pub fn offset(source_micros: i64) -> Result<String> {
    ensure!(
        source_micros.unsigned_abs() <= 86_400_000_000,
        "audio offset is outside the SSC export profile"
    );
    let magnitude = decimal(
        u128::from(source_micros.unsigned_abs()),
        1_000_000,
        86_400,
        "audio offset",
    )?;
    if source_micros > 0 {
        Ok(format!("-{magnitude}"))
    } else {
        Ok(magnitude)
    }
}

fn decimal(numerator: u128, denominator: u128, maximum: u128, label: &str) -> Result<String> {
    let value = Fraction::new(numerator, denominator).context("reduce decimal fraction")?;
    ensure!(
        value.numerator()
            <= maximum
                .checked_mul(value.denominator())
                .context("decimal profile bound overflow")?,
        "{label} is outside the SSC export profile"
    );
    let mut remaining = value.denominator();
    let mut twos = 0_u32;
    let mut fives = 0_u32;
    while remaining % 2 == 0 {
        remaining /= 2;
        twos += 1;
    }
    while remaining % 5 == 0 {
        remaining /= 5;
        fives += 1;
    }
    let places = twos.max(fives);
    ensure!(
        remaining == 1 && places <= MAX_DECIMAL_PLACES,
        "{label} has no supported exact terminating decimal"
    );
    let scale = 10_u128
        .checked_pow(places)
        .context("decimal scale overflow")?;
    let scaled = value
        .numerator()
        .checked_mul(scale / value.denominator())
        .context("decimal value overflow")?;
    if places == 0 {
        return Ok(scaled.to_string());
    }
    let width = usize::try_from(places).context("decimal width conversion")?;
    let whole = scaled / scale;
    let mut fractional = format!("{:0width$}", scaled % scale);
    while fractional.ends_with('0') {
        fractional.pop();
    }
    if fractional.is_empty() {
        Ok(whole.to_string())
    } else {
        Ok(format!("{whole}.{fractional}"))
    }
}

pub fn metadata(value: &str, label: &str) -> Result<String> {
    ensure!(!value.is_empty(), "SSC {label} must not be empty");
    ensure!(
        value.len() <= MAX_METADATA_BYTES,
        "SSC {label} exceeds byte limit"
    );
    ensure!(
        !value.contains("//")
            && value
                .bytes()
                .all(|byte| byte.is_ascii() && !byte.is_ascii_control()),
        "SSC {label} contains unsafe text"
    );
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '#' | ':' | ';') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    Ok(escaped)
}
