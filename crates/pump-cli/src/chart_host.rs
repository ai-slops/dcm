use anyhow::{Context, Result, ensure};
use pump_chart::{Limits, Music, Node, Plan, WeightedNode};
use wasmtime::StoreLimits;
use wasmtime::component::{Resource, ResourceTable};

use crate::chart_author_bindings::pump::chart::plan_builder::{
    self, WeightedNode as WitWeightedNode,
};

#[path = "chart_host_support.rs"]
mod support;
#[cfg(test)]
#[path = "chart_host_tests.rs"]
mod tests;

#[derive(Debug)]
pub struct HostBuilder {
    nodes: Option<Vec<Node>>,
    provenance: Vec<String>,
    edges: u64,
}

#[derive(Debug)]
pub struct HostState {
    pub table: ResourceTable,
    pub store_limits: StoreLimits,
    pub plan: Option<Plan>,
    music: Music,
    limits: Limits,
    hostcalls: u32,
    builder_created: bool,
}

impl plan_builder::Host for HostState {}

impl plan_builder::HostBuilder for HostState {
    fn new(&mut self) -> wasmtime::Result<Resource<HostBuilder>> {
        pump_chart::validate_limits(&self.limits)?;
        self.charge()?;
        ensure!(!self.builder_created, "only one chart builder is allowed");
        self.builder_created = true;
        self.table
            .push(HostBuilder {
                nodes: Some(Vec::new()),
                provenance: Vec::new(),
                edges: 0,
            })
            .context("allocate chart builder")
    }

    fn tap(
        &mut self,
        resource: Resource<HostBuilder>,
        panel_mask: u16,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.add_node(
            resource,
            Node::Tap {
                panel_mask,
                key: semantic_key,
            },
            provenance,
            0,
        )
    }

    fn hold(
        &mut self,
        resource: Resource<HostBuilder>,
        panel_mask: u16,
        duration_ticks: u64,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.add_node(
            resource,
            Node::Hold {
                panel_mask,
                duration_ticks,
                key: semantic_key,
            },
            provenance,
            0,
        )
    }

    fn rest(
        &mut self,
        resource: Resource<HostBuilder>,
        duration_ticks: u64,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.add_node(
            resource,
            Node::Rest {
                duration_ticks,
                key: semantic_key,
            },
            provenance,
            0,
        )
    }

    fn sequence(
        &mut self,
        resource: Resource<HostBuilder>,
        children: Vec<u32>,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        let edges = u64::try_from(children.len()).context("sequence edge count overflow")?;
        self.add_node(
            resource,
            Node::Sequence {
                children,
                key: semantic_key,
            },
            provenance,
            edges,
        )
    }

    fn parallel(
        &mut self,
        resource: Resource<HostBuilder>,
        children: Vec<u32>,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        let edges = u64::try_from(children.len()).context("parallel edge count overflow")?;
        self.add_node(
            resource,
            Node::Parallel {
                children,
                key: semantic_key,
            },
            provenance,
            edges,
        )
    }

    fn repeat(
        &mut self,
        resource: Resource<HostBuilder>,
        child: u32,
        times: u32,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.add_node(
            resource,
            Node::Repeat {
                child,
                count: times,
                key: semantic_key,
            },
            provenance,
            1,
        )
    }

    fn choice(
        &mut self,
        resource: Resource<HostBuilder>,
        alternatives: Vec<WitWeightedNode>,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        let edges = u64::try_from(alternatives.len()).context("choice edge count overflow")?;
        let max_edges = self.limits.max_edges;
        let edge_budget_exceeded = self
            .builder(&resource)?
            .edges
            .checked_add(edges)
            .is_none_or(|total| total > max_edges);
        if alternatives.is_empty()
            || edge_budget_exceeded
            || alternatives.iter().any(|branch| branch.weight == 0)
            || semantic_key.len()
                > usize::try_from(self.limits.max_string_bytes).unwrap_or(usize::MAX)
            || provenance.len()
                > usize::try_from(self.limits.max_string_bytes).unwrap_or(usize::MAX)
        {
            self.charge()?;
            return Ok(Err("invalid or oversized chart choice".to_owned()));
        }
        let branches = alternatives
            .into_iter()
            .map(|branch| WeightedNode {
                node: branch.node,
                weight: u128::from(branch.weight),
                key: semantic_key.clone(),
            })
            .collect();
        self.add_node(
            resource,
            Node::Choice {
                branches,
                key: semantic_key,
            },
            provenance,
            edges,
        )
    }

    fn mirror(
        &mut self,
        resource: Resource<HostBuilder>,
        child: u32,
        semantic_key: String,
        provenance: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.add_node(
            resource,
            Node::Mirror {
                child,
                key: semantic_key,
            },
            provenance,
            1,
        )
    }

    fn finish(
        &mut self,
        resource: Resource<HostBuilder>,
        root: u32,
    ) -> wasmtime::Result<Result<(), String>> {
        self.charge()?;
        let builder = self.builder(&resource)?;
        let nodes = builder
            .nodes
            .take()
            .context("chart builder already finished")?;
        let provenance = std::mem::take(&mut builder.provenance);
        let plan = Plan {
            music: self.music.clone(),
            nodes,
            provenance,
            root,
        };
        match pump_chart::validate_plan(&plan, &self.limits) {
            Ok(()) => {
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
            .context("drop chart builder")
    }
}
