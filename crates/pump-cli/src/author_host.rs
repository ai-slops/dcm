pub use crate::session::HostState;
use anyhow::{Context, Result};
use pump_core::{Builder, Limits, RelationKind, ScopeKind};
use wasmtime::component::Resource;

use crate::author_bindings::pump::author::plan_builder::{
    self, RelationKind as WitRelation, ScopeKind as WitScope, WeightedNode,
};

#[derive(Debug)]
pub struct HostBuilder {
    builder: Option<Builder>,
}

impl plan_builder::Host for HostState {}

impl plan_builder::HostBuilder for HostState {
    fn new(
        &mut self,
        max_nodes: u32,
        max_expansions: u32,
    ) -> wasmtime::Result<Resource<HostBuilder>> {
        self.charge()?;
        anyhow::ensure!(
            !self.builder_created,
            "only one builder is allowed per build session"
        );
        self.builder_created = true;
        let defaults = Limits::default();
        let limits = Limits {
            max_nodes: max_nodes.min(defaults.max_nodes),
            max_expansions: max_expansions.min(defaults.max_expansions),
            ..defaults
        };
        self.table
            .push(HostBuilder {
                builder: Some(Builder::new(limits)),
            })
            .context("allocate builder resource")
    }

    fn tap(
        &mut self,
        resource: Resource<HostBuilder>,
        mask: u16,
        duration: u32,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        Ok(self
            .builder(&resource)?
            .tap(mask, duration, &id, &source)
            .map(|node| node.0)
            .map_err(|error| error.to_string()))
    }

    fn sequence(
        &mut self,
        resource: Resource<HostBuilder>,
        children: Vec<u32>,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.collection(resource, children, id, source, false)
    }

    fn parallel(
        &mut self,
        resource: Resource<HostBuilder>,
        children: Vec<u32>,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.collection(resource, children, id, source, true)
    }

    fn repeat(
        &mut self,
        resource: Resource<HostBuilder>,
        child: u32,
        times: u32,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        Ok(self
            .builder(&resource)?
            .repeat(pump_core::NodeId(child), times, &id, &source)
            .map(|node| node.0)
            .map_err(|error| error.to_string()))
    }

    fn choice(
        &mut self,
        resource: Resource<HostBuilder>,
        alternatives: Vec<WeightedNode>,
        duration: Option<u32>,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        anyhow::ensure!(alternatives.len() <= 4096, "choice edge budget exceeded");
        let nodes: Vec<(u32, pump_core::NodeId)> = alternatives
            .into_iter()
            .map(|item| (item.weight, pump_core::NodeId(item.node)))
            .collect();
        Ok(self
            .builder(&resource)?
            .choice(&nodes, duration, &id, &source)
            .map(|node| node.0)
            .map_err(|error| error.to_string()))
    }

    fn scope(
        &mut self,
        resource: Resource<HostBuilder>,
        kind: WitScope,
        key: String,
        child: u32,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        let kind = match kind {
            WitScope::Run => ScopeKind::Run,
            WitScope::Section => ScopeKind::Section,
            WitScope::Phrase => ScopeKind::Phrase,
        };
        Ok(self
            .builder(&resource)?
            .scope(kind, &key, pump_core::NodeId(child), &id, &source)
            .map(|node| node.0)
            .map_err(|error| error.to_string()))
    }

    fn mirror(
        &mut self,
        resource: Resource<HostBuilder>,
        child: u32,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        Ok(self
            .builder(&resource)?
            .mirror(pump_core::NodeId(child), &id, &source)
            .map(|node| node.0)
            .map_err(|error| error.to_string()))
    }

    fn relation(
        &mut self,
        resource: Resource<HostBuilder>,
        kind: WitRelation,
        left: u32,
        right: u32,
        id: String,
        source: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        let kind = match kind {
            WitRelation::Same => RelationKind::Same,
            WitRelation::Different => RelationKind::Different,
        };
        Ok(self
            .builder(&resource)?
            .relation(
                kind,
                pump_core::NodeId(left),
                pump_core::NodeId(right),
                &id,
                &source,
            )
            .map(|node| node.0)
            .map_err(|error| error.to_string()))
    }

    fn finish(
        &mut self,
        resource: Resource<HostBuilder>,
        root: u32,
    ) -> wasmtime::Result<Result<(), String>> {
        self.charge()?;
        let result = self
            .table
            .get_mut(&resource)?
            .builder
            .take()
            .context("builder already finished")?
            .finish(pump_core::NodeId(root));
        match result {
            Ok(plan) => {
                self.plan = Some(plan);
                Ok(Ok(()))
            }
            Err(error) => Ok(Err(error.to_string())),
        }
    }

    fn drop(&mut self, resource: Resource<HostBuilder>) -> wasmtime::Result<()> {
        self.table
            .delete(resource)
            .map(|_| ())
            .context("drop builder resource")
    }
}

impl HostState {
    fn builder(&mut self, resource: &Resource<HostBuilder>) -> wasmtime::Result<&mut Builder> {
        self.table
            .get_mut(resource)?
            .builder
            .as_mut()
            .context("builder already finished")
    }

    fn collection(
        &mut self,
        resource: Resource<HostBuilder>,
        children: Vec<u32>,
        id: String,
        source: String,
        parallel: bool,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        anyhow::ensure!(children.len() <= 4096, "collection edge budget exceeded");
        let nodes: Vec<pump_core::NodeId> = children.into_iter().map(pump_core::NodeId).collect();
        let result = if parallel {
            self.builder(&resource)?.parallel(&nodes, &id, &source)
        } else {
            self.builder(&resource)?.sequence(&nodes, &id, &source)
        };
        Ok(result.map(|node| node.0).map_err(|error| error.to_string()))
    }
}
