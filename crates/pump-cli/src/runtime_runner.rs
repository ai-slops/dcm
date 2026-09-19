use anyhow::{Context, Result, ensure};
use pump_core::CommandTrace;
use wasmtime::component::{Component, Linker};
use wasmtime::{Engine, Store, StoreLimits};

use crate::{bundle, engine, runtime_bindings::RuntimeWorld};

/// Compiles a runtime once; each generation gets an isolated, fuel-limited store.
pub struct RuntimeRunner {
    engine: Engine,
    component: Component,
}

impl RuntimeRunner {
    pub fn new(bytes: &[u8]) -> Result<Self> {
        let engine = engine::engine()?;
        let component = Component::new(&engine, bytes).context("compile runtime component")?;
        ensure!(
            component.component_type().imports(&engine).next().is_none(),
            "runtime component imports are forbidden"
        );
        let runner = Self { engine, component };
        runner.instantiate()?;
        Ok(runner)
    }

    fn instantiate(&self) -> Result<(Store<StoreLimits>, RuntimeWorld)> {
        let linker = Linker::new(&self.engine);
        let mut store = Store::new(&self.engine, engine::limits());
        store.limiter(|limits| limits);
        engine::fuel(&mut store)?;
        let bindings = RuntimeWorld::instantiate(&mut store, &self.component, &linker)
            .context("runtime does not implement pump:runtime/runtime@0.1.0")?;
        Ok((store, bindings))
    }

    pub fn generate(&self, plan: &[u8], seed: &[u8]) -> Result<CommandTrace> {
        let (mut store, bindings) = self.instantiate()?;
        let bytes = bindings
            .pump_runtime_runtime()
            .call_generate(&mut store, plan, seed)
            .context("invoke runtime generate")?
            .map_err(anyhow::Error::msg)?;
        let trace = pump_core::decode_trace(&bytes).context("decode runtime trace")?;
        ensure!(
            trace.plan_digest == bundle::digest(plan),
            "runtime trace plan binding mismatch"
        );
        ensure!(
            trace.seed_digest == bundle::digest(seed),
            "runtime trace seed binding mismatch"
        );
        Ok(trace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_runtime_export_is_rejected() {
        // Given an import-free component without the required interface.
        let component = b"(component)";
        // When inspecting it as a runtime.
        let result = RuntimeRunner::new(component);
        // Then import-freedom alone is insufficient.
        assert!(result.is_err());
    }
}
