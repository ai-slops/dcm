use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use wasmtime::component::{Component, HasSelf, Linker, Resource};
use wasmtime::{Engine, Store};

use crate::package::{LoadedResolution, LockedPackage, PackageLock, Role};
use crate::package_bindings::pump::packages::registry::{self, PatternArgs, StylePolicy};
use crate::package_session::{HostBuilder, Invocation, PackageState, lock};
use crate::pattern_bindings::PatternWorld;
use crate::pattern_bindings::exports::pump::packages::pattern::PatternArgs as ChildPatternArgs;

#[derive(Clone)]
pub struct RegistryEntry {
    pub key: String,
    pub sha256: String,
    pub package: LockedPackage,
    pub component: Component,
    pub bytes: Vec<u8>,
}

pub struct PackageRegistry {
    pub(crate) engine: Engine,
    lock: PackageLock,
    entries: BTreeMap<String, RegistryEntry>,
}

impl PackageRegistry {
    pub fn compile(engine: &Engine, resolution: LoadedResolution) -> Result<Arc<Self>> {
        let mut entries = BTreeMap::new();
        for package in &resolution.lock.packages {
            let bytes = resolution
                .components
                .get(&package.key)
                .context("resolved package bytes missing")?;
            let component = Component::new(engine, bytes)
                .with_context(|| format!("compile package {}", package.key))?;
            crate::package_component::validate(engine, &component, package.role)?;
            entries.insert(
                package.key.clone(),
                RegistryEntry {
                    key: package.key.clone(),
                    sha256: package.sha256.clone(),
                    package: package.clone(),
                    component,
                    bytes: bytes.clone(),
                },
            );
        }
        Ok(Arc::new(Self {
            engine: engine.clone(),
            lock: resolution.lock,
            entries,
        }))
    }

    pub fn song_entry(&self) -> Result<&RegistryEntry> {
        self.entries
            .get(&self.lock.song)
            .context("locked song package missing")
    }

    pub(crate) fn entry(&self, key: &str, role: Role, export: &str) -> Result<&RegistryEntry> {
        let entry = self
            .entries
            .get(key)
            .context("unknown locked package key")?;
        ensure!(entry.package.role == role, "package role mismatch");
        ensure!(
            entry.package.exports.iter().any(|value| value == export),
            "unknown package export"
        );
        Ok(entry)
    }
}

impl registry::Host for PackageState {
    fn instantiate_pattern(
        &mut self,
        target: Resource<HostBuilder>,
        key: String,
        export: String,
        args: PatternArgs,
        occurrence: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        match self.invoke_pattern(&target, &key, &export, args, &occurrence) {
            Ok(node) => Ok(Ok(node)),
            Err(error) => Ok(Err(error.to_string())),
        }
    }

    fn instantiate_style(
        &mut self,
        key: String,
        export: String,
    ) -> wasmtime::Result<Result<StylePolicy, String>> {
        match self.invoke_style(&key, &export) {
            Ok(policy) => Ok(Ok(policy)),
            Err(error) => Ok(Err(error.to_string())),
        }
    }
}

impl PackageState {
    fn invoke_pattern(
        &mut self,
        target: &Resource<HostBuilder>,
        key: &str,
        export: &str,
        args: PatternArgs,
        occurrence: &str,
    ) -> Result<u32> {
        let registry = Arc::clone(
            self.registry
                .as_ref()
                .context("package registry unavailable")?,
        );
        let shared = self.table.get(target)?.shared.clone();
        let (before, fuel) = {
            let mut session = lock(&shared)?;
            session.charge_registry(Some(occurrence))?;
            (session.node_count(), session.child_fuel)
        };
        let entry = registry.entry(key, Role::Pattern, export)?;
        ensure!(
            args.base_panel < 10 && (1..=16).contains(&args.length),
            "pattern arguments are outside the public contract"
        );
        ensure!(fuel > 0, "child fuel pool exhausted");
        let identity = serde_json::to_vec(&(&entry.sha256, export, occurrence))?;
        let namespace = format!("pattern:{}", crate::bundle::digest(&identity));
        let provenance = format!("pkg:{}:{}", entry.sha256, crate::bundle::digest(&identity));
        let mut state = PackageState::new(shared.clone(), None);
        let child_resource =
            state
                .table
                .push(HostBuilder::child(shared.clone(), namespace, provenance))?;
        let child_rep = child_resource.rep();
        let child_args = ChildPatternArgs {
            base_panel: args.base_panel,
            length: args.length,
            allow_mirror: args.allow_mirror,
        };
        let mut store = Store::new(&registry.engine, state);
        store.limiter(|state| &mut state.limits);
        store.set_fuel(fuel)?;
        let mut linker = Linker::<PackageState>::new(&registry.engine);
        PatternWorld::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)?;
        let result = crate::package_budget::run_child(&shared, &mut store, |store| {
            PatternWorld::instantiate(&mut *store, &entry.component, &linker).and_then(|bindings| {
                let description = bindings
                    .pump_packages_pattern()
                    .call_describe(&mut *store)?;
                ensure!(
                    description.contract == crate::package::PATTERN_CONTRACT,
                    "pattern describe contract mismatch"
                );
                ensure!(
                    description.capabilities == entry.package.capabilities,
                    "pattern describe capabilities mismatch"
                );
                bindings
                    .pump_packages_pattern()
                    .call_render(store, child_resource, child_args)
            })
        });
        let local = match result {
            Ok(Ok(node)) => node,
            Ok(Err(message)) => {
                return self.poison_child(&shared, before, anyhow::anyhow!(message));
            }
            Err(error) => return self.poison_child(&shared, before, error),
        };
        let local_resource: Resource<HostBuilder> = Resource::new_borrow(child_rep);
        let resolved = store
            .data()
            .table
            .get(&local_resource)
            .map_err(anyhow::Error::from)
            .and_then(|view| view.resolve(local));
        let global = match resolved {
            Ok(node) => node,
            Err(error) => return self.poison_child(&shared, before, error),
        };
        let mut session = lock(&shared)?;
        session.invocations.push(Invocation {
            package_key: entry.key.clone(),
            package_sha256: entry.sha256.clone(),
            export: export.to_owned(),
            occurrence: occurrence.to_owned(),
            style_policy: None,
        });
        drop(session);
        self.table.get_mut(target)?.alias(global)
    }

    fn poison_child<T>(
        &self,
        shared: &Arc<std::sync::Mutex<crate::package_session::BuilderSession>>,
        before: usize,
        error: anyhow::Error,
    ) -> Result<T> {
        lock(shared)?.poison_if_mutated(before);
        Err(error)
    }
}
