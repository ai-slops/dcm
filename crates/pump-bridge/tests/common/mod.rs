use pump_chart::{Fraction, Music, TempoSegment};
use pump_core::{Builder, NodeId, RuntimePlan};

pub fn music(duration_ticks: u64) -> Result<Music, pump_chart::FractionError> {
    Ok(Music {
        duration_ticks,
        ticks_per_beat: 48,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [7; 32],
        reference_accents: Vec::new(),
    })
}

pub fn runtime(builder: Builder, root: NodeId) -> Result<RuntimePlan, pump_core::PlanError> {
    pump_core::compile(&builder.finish(root)?)
}

pub fn tap(
    builder: &mut Builder,
    mask: u16,
    duration: u32,
    id: &str,
) -> Result<NodeId, pump_core::PlanError> {
    builder.tap(mask, duration, id, "test")
}
