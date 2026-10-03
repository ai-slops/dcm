use pump_chart::{Fraction, Music};

use crate::EvalError;

pub(crate) fn elapsed(
    music: &Music,
    start_tick: u64,
    end_tick: u64,
) -> Result<Fraction, EvalError> {
    pump_chart::elapsed_time(music, start_tick, end_tick).map_err(|error| match &error {
        pump_chart::TimingError::Fraction(_) | pump_chart::TimingError::Overflow => {
            EvalError::ArithmeticOverflow
        }
        pump_chart::TimingError::TickOutsideMusic | pump_chart::TimingError::InvalidMusic(_) => {
            EvalError::InvalidChart(error.to_string())
        }
    })
}

pub(crate) fn at_least(value: Fraction, integer: u64) -> Result<bool, EvalError> {
    let required = u128::from(integer)
        .checked_mul(value.denominator())
        .ok_or(EvalError::ArithmeticOverflow)?;
    Ok(value.numerator() >= required)
}
