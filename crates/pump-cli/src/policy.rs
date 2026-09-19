use crate::{artifact_io, bundle, engine};

pub fn digest() -> anyhow::Result<String> {
    let limits = pump_core::Limits::default();
    let fields = [
        u64::from(limits.max_nodes),
        u64::from(limits.max_depth),
        u64::from(limits.max_trace),
        u64::from(limits.max_expansions),
        u64::from(limits.max_edges),
        u64::from(limits.max_string_bytes),
        u64::try_from(pump_core::MAX_STRING_BYTES)?,
        engine::FUEL,
        u64::try_from(engine::MEMORY_BYTES)?,
        u64::try_from(engine::TABLE_ELEMENTS)?,
        u64::try_from(engine::INSTANCES)?,
        u64::try_from(engine::TABLES)?,
        u64::try_from(engine::MEMORIES)?,
        u64::from(engine::HOSTCALLS),
        artifact_io::ARTIFACT_LIMIT,
    ];
    let mut bytes = b"pump-compiler-policy-v1\0".to_vec();
    for field in fields {
        bytes.extend_from_slice(&field.to_le_bytes());
    }
    Ok(bundle::digest(&bytes))
}
