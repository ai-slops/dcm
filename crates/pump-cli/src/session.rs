use anyhow::{Context, Result};
use pump_core::Plan;
use wasmtime::StoreLimits;
use wasmtime::component::ResourceTable;

#[derive(Debug)]
pub struct HostState {
    pub table: ResourceTable,
    pub limits: StoreLimits,
    pub plan: Option<Plan>,
    hostcalls: u32,
    pub(crate) builder_created: bool,
}

impl HostState {
    pub fn new(limits: StoreLimits) -> Self {
        Self {
            table: ResourceTable::new(),
            limits,
            plan: None,
            hostcalls: 0,
            builder_created: false,
        }
    }

    pub fn take_plan(&mut self) -> Result<Plan> {
        self.plan.take().context("author did not finish a plan")
    }

    pub(crate) fn charge(&mut self) -> wasmtime::Result<()> {
        self.hostcalls = self
            .hostcalls
            .checked_add(1)
            .context("hostcall counter overflow")?;
        anyhow::ensure!(
            self.hostcalls <= crate::engine::HOSTCALLS,
            "hostcall budget exceeded"
        );
        Ok(())
    }
}
