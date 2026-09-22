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

pub fn package_digest() -> anyhow::Result<String> {
    let fields = [
        crate::package_session::ROOT_FUEL,
        crate::package_session::CHILD_FUEL,
        u64::from(crate::package_session::REGISTRY_ATTEMPTS),
        u64::try_from(crate::engine::PACKAGE_MEMORY_BYTES)?,
        u64::try_from(crate::package::PACKAGE_LIMIT)?,
        crate::package::TOTAL_COMPONENT_LIMIT,
        crate::package::MANIFEST_LIMIT,
    ];
    let mut bytes = b"pump-package-policy-v1\0".to_vec();
    bytes.extend_from_slice(digest()?.as_bytes());
    for field in fields {
        bytes.extend_from_slice(&field.to_le_bytes());
    }
    bytes.extend_from_slice(include_bytes!("../../../wit/package/world.wit"));
    Ok(bundle::digest(&bytes))
}
