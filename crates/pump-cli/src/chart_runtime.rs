use anyhow::{Context, Result, ensure};
use pump_chart::{GeneratedChart, GenerationRequest, RuntimeProgram};
use wasmtime::component::{Component, Linker};
use wasmtime::{Engine, Store, StoreLimits};

use crate::chart_runtime_bindings::RuntimeWorld;

pub struct ChartRuntime {
    engine: Engine,
    component: Component,
}

impl ChartRuntime {
    pub fn new(bytes: &[u8]) -> Result<Self> {
        let engine = crate::engine::engine()?;
        let component =
            Component::new(&engine, bytes).context("compile chart runtime component")?;
        ensure!(
            component.component_type().imports(&engine).next().is_none(),
            "chart runtime component imports are forbidden"
        );
        let runner = Self { engine, component };
        runner.instantiate()?;
        Ok(runner)
    }

    pub fn generate(
        &self,
        program: &RuntimeProgram,
        request: &GenerationRequest,
    ) -> Result<GeneratedChart> {
        let program_bytes =
            pump_chart::encode_runtime_program(program).context("encode runtime program")?;
        let request_bytes =
            pump_chart::encode_generation_request(request).context("encode generation request")?;
        let (mut store, bindings) = self.instantiate()?;
        let generated_bytes = bindings
            .pump_chart_runtime()
            .call_generate(&mut store, &program_bytes, &request_bytes)
            .context("invoke chart runtime generate")?
            .map_err(anyhow::Error::msg)?;
        let generated =
            pump_chart::decode_generated_chart(&generated_bytes, &pump_chart::Limits::default())
                .context("decode generated chart")?;
        validate_selection(program, request, &generated)?;
        Ok(generated)
    }

    fn instantiate(&self) -> Result<(Store<StoreLimits>, RuntimeWorld)> {
        let linker = Linker::new(&self.engine);
        let mut store = Store::new(&self.engine, crate::engine::limits());
        store.limiter(|limits| limits);
        crate::engine::fuel(&mut store)?;
        let bindings = RuntimeWorld::instantiate(&mut store, &self.component, &linker)
            .context("runtime does not implement pump:chart/runtime@0.2.0")?;
        Ok((store, bindings))
    }
}

pub(crate) fn validate_selection(
    program: &RuntimeProgram,
    request: &GenerationRequest,
    generated: &GeneratedChart,
) -> Result<()> {
    let expected =
        pump_chart::generate(program, request).context("compute reference chart selection")?;
    ensure!(
        *generated == expected,
        "runtime output differs from reference chart selection"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_with_import_is_rejected() {
        let result = ChartRuntime::new(b"(component (import \"evil\" (func)))");
        assert!(result.is_err());
    }
}
