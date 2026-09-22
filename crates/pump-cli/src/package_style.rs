use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use wasmtime::Store;
use wasmtime::component::Linker;

use crate::package::Role;
use crate::package_bindings::pump::packages::registry::StylePolicy;
use crate::package_session::{Invocation, PackageState, StyleSnapshot, lock};
use crate::style_bindings::StyleWorld;

impl PackageState {
    pub(crate) fn invoke_style(&mut self, key: &str, export: &str) -> Result<StylePolicy> {
        let registry = Arc::clone(
            self.registry
                .as_ref()
                .context("package registry unavailable")?,
        );
        let fuel = {
            let mut session = lock(&self.shared)?;
            session.charge_registry(None)?;
            session.child_fuel
        };
        let entry = registry.entry(key, Role::Style, export)?;
        ensure!(fuel > 0, "child fuel pool exhausted");
        let mut store = Store::new(
            &registry.engine,
            PackageState::new(self.shared.clone(), None),
        );
        store.limiter(|state| &mut state.limits);
        store.set_fuel(fuel)?;
        let linker = Linker::<PackageState>::new(&registry.engine);
        let (description, child_policy) =
            crate::package_budget::run_child(&self.shared, &mut store, |store| {
                let bindings = StyleWorld::instantiate(&mut *store, &entry.component, &linker)?;
                let description = bindings.pump_packages_style().call_describe(&mut *store)?;
                ensure!(
                    description.contract == crate::package::STYLE_CONTRACT,
                    "style describe contract mismatch"
                );
                ensure!(
                    !description.policy_id.is_empty() && description.policy_id.len() <= 128,
                    "invalid style policy id"
                );
                let policy = bindings.pump_packages_style().call_policy(store)?;
                Ok((description, policy))
            })?;
        ensure!(
            child_policy.primary_weight > 0 && child_policy.variation_weight > 0,
            "style returned invalid weights"
        );
        lock(&self.shared)?.invocations.push(Invocation {
            package_key: entry.key.clone(),
            package_sha256: entry.sha256.clone(),
            export: export.to_owned(),
            occurrence: description.policy_id,
            style_policy: Some(StyleSnapshot {
                primary_weight: child_policy.primary_weight,
                variation_weight: child_policy.variation_weight,
                allow_mirror: child_policy.allow_mirror,
            }),
        });
        Ok(StylePolicy {
            primary_weight: child_policy.primary_weight,
            variation_weight: child_policy.variation_weight,
            allow_mirror: child_policy.allow_mirror,
        })
    }
}
