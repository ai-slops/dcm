use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, MutexGuard};

use anyhow::{Context, Result, ensure};
use pump_core::{Builder, Limits, NodeId, Plan};
use serde::{Deserialize, Serialize};
use wasmtime::StoreLimits;
use wasmtime::component::ResourceTable;

use crate::package_registry::PackageRegistry;

pub const ROOT_FUEL: u64 = 5_000_000;
pub const CHILD_FUEL: u64 = 5_000_000;
pub const REGISTRY_ATTEMPTS: u32 = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invocation {
    pub package_key: String,
    pub package_sha256: String,
    pub export: String,
    pub occurrence: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_policy: Option<StyleSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StyleSnapshot {
    pub primary_weight: u32,
    pub variation_weight: u32,
    pub allow_mirror: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvocationReport {
    pub schema_version: u16,
    pub package_lock_sha256: String,
    pub invocations: Vec<Invocation>,
}

#[derive(Debug)]
pub struct BuilderSession {
    pub builder: Option<Builder>,
    pub plan: Option<Plan>,
    pub poisoned: bool,
    pub hostcalls: u32,
    pub registry_attempts: u32,
    pub child_fuel: u64,
    pub occurrences: BTreeSet<String>,
    pub invocations: Vec<Invocation>,
    pub created: bool,
}

impl BuilderSession {
    pub fn new(limits: Limits) -> Self {
        Self {
            builder: Some(Builder::new(limits)),
            plan: None,
            poisoned: false,
            hostcalls: 0,
            registry_attempts: 0,
            child_fuel: CHILD_FUEL,
            occurrences: BTreeSet::new(),
            invocations: Vec::new(),
            created: false,
        }
    }

    pub fn start_builder(&mut self, limits: Limits) -> Result<()> {
        self.charge_hostcall()?;
        ensure!(!self.created, "only one builder is allowed per song");
        self.created = true;
        self.builder = Some(Builder::new(limits));
        Ok(())
    }

    pub fn charge_hostcall(&mut self) -> Result<()> {
        ensure!(!self.poisoned, "builder session is poisoned");
        ensure!(self.plan.is_none(), "builder session is finished");
        self.hostcalls = self
            .hostcalls
            .checked_add(1)
            .context("hostcall counter overflow")?;
        ensure!(
            self.hostcalls <= crate::engine::HOSTCALLS,
            "hostcall budget exceeded"
        );
        Ok(())
    }

    pub fn charge_registry(&mut self, occurrence: Option<&str>) -> Result<()> {
        self.charge_hostcall()?;
        self.registry_attempts = self
            .registry_attempts
            .checked_add(1)
            .context("registry counter overflow")?;
        ensure!(
            self.registry_attempts <= REGISTRY_ATTEMPTS,
            "registry attempt budget exceeded"
        );
        if let Some(key) = occurrence {
            ensure!(
                !key.is_empty() && key.len() <= 128,
                "invalid occurrence key"
            );
            ensure!(
                self.occurrences.insert(key.to_owned()),
                "duplicate occurrence key"
            );
        }
        Ok(())
    }

    pub fn node_count(&self) -> usize {
        self.builder.as_ref().map_or(0, Builder::node_count)
    }

    pub fn poison_if_mutated(&mut self, before: usize) {
        if self.node_count() > before {
            self.poisoned = true;
        }
    }
}

#[derive(Debug)]
pub struct HostBuilder {
    pub shared: Arc<Mutex<BuilderSession>>,
    pub nodes: BTreeMap<u32, NodeId>,
    pub next: u32,
    pub namespace: String,
    pub provenance: String,
    pub can_finish: bool,
}

impl HostBuilder {
    pub fn parent(
        shared: Arc<Mutex<BuilderSession>>,
        namespace: String,
        provenance: String,
    ) -> Self {
        Self {
            shared,
            nodes: BTreeMap::new(),
            next: 0,
            namespace,
            provenance,
            can_finish: true,
        }
    }

    pub fn child(
        shared: Arc<Mutex<BuilderSession>>,
        namespace: String,
        provenance: String,
    ) -> Self {
        Self {
            shared,
            nodes: BTreeMap::new(),
            next: 0,
            namespace,
            provenance,
            can_finish: false,
        }
    }

    pub fn resolve(&self, local: u32) -> Result<NodeId> {
        self.nodes
            .get(&local)
            .copied()
            .context("foreign or unknown node handle")
    }

    pub fn alias(&mut self, node: NodeId) -> Result<u32> {
        let local = self.next;
        self.next = self
            .next
            .checked_add(1)
            .context("local node handle overflow")?;
        self.nodes.insert(local, node);
        Ok(local)
    }

    pub fn id(&self, stable: &str) -> Result<String> {
        ensure!(
            !stable.is_empty() && stable.len() <= 128,
            "invalid stable identifier"
        );
        Ok(format!("{}/{}", self.namespace, stable))
    }
}

pub struct PackageState {
    pub table: ResourceTable,
    pub limits: StoreLimits,
    pub registry: Option<Arc<PackageRegistry>>,
    pub shared: Arc<Mutex<BuilderSession>>,
}

impl PackageState {
    pub fn new(shared: Arc<Mutex<BuilderSession>>, registry: Option<Arc<PackageRegistry>>) -> Self {
        Self {
            table: ResourceTable::new(),
            limits: crate::engine::package_limits(),
            registry,
            shared,
        }
    }
}

pub fn lock(session: &Arc<Mutex<BuilderSession>>) -> Result<MutexGuard<'_, BuilderSession>> {
    session
        .lock()
        .map_err(|_| anyhow::anyhow!("builder session mutex poisoned"))
}
