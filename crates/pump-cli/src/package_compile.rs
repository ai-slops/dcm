use std::fs;
use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use wasmtime::Store;
use wasmtime::component::{HasSelf, Linker};

use crate::bundle;
use crate::package::{self, LoadedResolution, PackageLock};
use crate::package_bindings::SongWorld;
use crate::package_lifecycle::empty_session;
use crate::package_registry::PackageRegistry;
use crate::package_session::{InvocationReport, PackageState, ROOT_FUEL, lock};

pub fn resolve(manifest: &Path, out: &Path) -> Result<PackageLock> {
    let resolution = package::resolve(manifest)?;
    write_new(
        out,
        &serde_json::to_vec_pretty(&resolution.lock).context("encode package lock")?,
    )?;
    Ok(resolution.lock)
}

pub fn compile(
    manifest: &Path,
    lock_path: &Path,
    runtime: &Path,
    out: &Path,
) -> Result<bundle::Manifest> {
    compile_loaded(load_source(manifest, lock_path)?, runtime, out)
}

pub struct LockedResolution {
    pub resolution: LoadedResolution,
    pub lock_bytes: Vec<u8>,
}

pub fn load_source(manifest: &Path, lock_path: &Path) -> Result<LockedResolution> {
    let resolution = package::resolve(manifest)?;
    let lock_bytes = crate::artifact_io::read(lock_path, package::MANIFEST_LIMIT)?;
    let supplied: PackageLock =
        serde_json::from_slice(&lock_bytes).context("decode package lock")?;
    ensure!(
        supplied.schema_version == 1,
        "unsupported package lock schema"
    );
    ensure!(
        supplied == resolution.lock,
        "package lock does not exactly match source artifacts"
    );
    Ok(LockedResolution {
        resolution,
        lock_bytes,
    })
}

pub fn compile_loaded(
    input: LockedResolution,
    runtime: &Path,
    out: &Path,
) -> Result<bundle::Manifest> {
    let LockedResolution {
        resolution,
        lock_bytes,
    } = input;
    let engine = crate::engine::engine()?;
    let registry = PackageRegistry::compile(&engine, resolution)?;
    let song = registry.song_entry()?.clone();
    let shared = empty_session();
    let mut store = Store::new(
        &engine,
        PackageState::new(shared.clone(), Some(Arc::clone(&registry))),
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(ROOT_FUEL)?;
    let mut linker = Linker::<PackageState>::new(&engine);
    SongWorld::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)?;
    let bindings = SongWorld::instantiate(&mut store, &song.component, &linker)
        .context("instantiate song package")?;
    bindings
        .pump_packages_song()
        .call_build(&mut store)?
        .map_err(anyhow::Error::msg)?;
    let mut session = lock(&shared)?;
    ensure!(!session.poisoned, "song left the builder session poisoned");
    let plan = session.plan.take().context("song did not finish a plan")?;
    let report = serde_json::to_vec_pretty(&InvocationReport {
        schema_version: 1,
        package_lock_sha256: bundle::digest(&lock_bytes),
        invocations: session.invocations.clone(),
    })
    .context("encode invocation report")?;
    drop(session);
    let runtime_bytes = crate::artifact_io::read(runtime, crate::artifact_io::ARTIFACT_LIMIT)?;
    let runtime_component = wasmtime::component::Component::new(&engine, &runtime_bytes)?;
    crate::commands::ensure_runtime_import_free(&engine, &runtime_component)?;
    crate::runtime_runner::RuntimeRunner::new(&runtime_bytes)?;
    let runtime_plan = pump_core::compile(&plan).context("compile package plan")?;
    let plan_bytes = pump_core::encode_runtime_plan(&runtime_plan)?;
    let analysis = serde_json::to_vec_pretty(&pump_core::analyze(&runtime_plan)?)?;
    bundle::write(
        out,
        &bundle::Artifacts {
            author: &song.bytes,
            runtime: &runtime_bytes,
            plan: &plan_bytes,
            analysis: &analysis,
            package_lock: Some(&lock_bytes),
            invocation_report: Some(&report),
        },
    )
}

pub fn compatible(required: &Path, candidate: &Path, key: &str) -> Result<()> {
    let required = read_lock(required)?;
    let candidate = read_lock(candidate)?;
    let left = required
        .packages
        .iter()
        .find(|package| package.key == key)
        .context("required lock key missing")?;
    let right = candidate
        .packages
        .iter()
        .find(|package| package.key == key)
        .context("candidate lock key missing")?;
    package::ensure_compatible(left, right)
}

fn read_lock(path: &Path) -> Result<PackageLock> {
    let lock = serde_json::from_slice(&crate::artifact_io::read(path, package::MANIFEST_LIMIT)?)
        .with_context(|| format!("decode {}", path.display()))?;
    crate::package_validation::validate_lock(&lock)?;
    Ok(lock)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("write {}", path.display()))
}
