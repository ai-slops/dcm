use anyhow::{Context, Result, ensure};
use pump_chart::{Limits, Music, Node, Plan};
use wasmtime::StoreLimits;
use wasmtime::component::Resource;

use crate::chart_host::{HostBuilder, HostState};

impl HostState {
    pub fn new(music: Music, limits: Limits, store_limits: StoreLimits) -> Self {
        Self {
            table: wasmtime::component::ResourceTable::new(),
            store_limits,
            plan: None,
            music,
            limits,
            hostcalls: 0,
            builder_created: false,
        }
    }

    pub fn take_plan(&mut self) -> Result<Plan> {
        self.plan
            .take()
            .context("chart author did not finish a plan")
    }

    pub(super) fn charge(&mut self) -> wasmtime::Result<()> {
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

    pub(super) fn builder(
        &mut self,
        resource: &Resource<HostBuilder>,
    ) -> wasmtime::Result<&mut HostBuilder> {
        self.table.get_mut(resource).context("access chart builder")
    }

    pub(super) fn add_node(
        &mut self,
        resource: Resource<HostBuilder>,
        node: Node,
        provenance: String,
        added_edges: u64,
    ) -> wasmtime::Result<Result<u32, String>> {
        self.charge()?;
        if let Err(error) = validate_node_boundary(&node) {
            return Ok(Err(error));
        }
        let limits = self.limits;
        let builder = self.builder(&resource)?;
        let Some(nodes) = builder.nodes.as_mut() else {
            return Ok(Err("chart builder already finished".to_owned()));
        };
        let id = match u32::try_from(nodes.len()) {
            Ok(id) => id,
            Err(error) => return Ok(Err(error.to_string())),
        };
        if id >= limits.max_nodes {
            return Ok(Err("chart node budget exceeded".to_owned()));
        }
        if nodes
            .iter()
            .any(|existing| node_key(existing) == node_key(&node))
        {
            return Ok(Err("chart semantic keys must be unique".to_owned()));
        }
        if has_forward_reference(&node, id) {
            return Ok(Err("chart node references must point backward".to_owned()));
        }
        let key_bytes = node_key(&node).len();
        if key_bytes > usize::try_from(limits.max_string_bytes).unwrap_or(usize::MAX)
            || provenance.len() > usize::try_from(limits.max_string_bytes).unwrap_or(usize::MAX)
        {
            return Ok(Err("chart string budget exceeded".to_owned()));
        }
        let Some(edges) = builder.edges.checked_add(added_edges) else {
            return Ok(Err("chart edge counter overflow".to_owned()));
        };
        if edges > limits.max_edges {
            return Ok(Err("chart edge budget exceeded".to_owned()));
        }
        builder.edges = edges;
        nodes.push(node);
        builder.provenance.push(provenance);
        Ok(Ok(id))
    }
}

fn validate_node_boundary(node: &Node) -> Result<(), String> {
    match node {
        Node::Tap { panel_mask, .. } => validate_mask(*panel_mask),
        Node::Hold {
            panel_mask,
            duration_ticks,
            ..
        } => {
            validate_mask(*panel_mask)?;
            if *duration_ticks == 0 {
                return Err("chart hold duration must be positive".to_owned());
            }
            Ok(())
        }
        Node::Rest { duration_ticks, .. } => {
            if *duration_ticks == 0 {
                return Err("chart rest duration must be positive".to_owned());
            }
            Ok(())
        }
        Node::Sequence { children, .. } | Node::Parallel { children, .. } => {
            if children.is_empty() {
                return Err("chart composite must contain a child".to_owned());
            }
            Ok(())
        }
        Node::Repeat { count, .. } => {
            if *count == 0 {
                return Err("chart repeat count must be positive".to_owned());
            }
            Ok(())
        }
        Node::Choice { branches, .. } => {
            if branches.is_empty() || branches.iter().any(|branch| branch.weight == 0) {
                return Err("chart choice must have positive-weight branches".to_owned());
            }
            Ok(())
        }
        Node::Mirror { .. } => Ok(()),
    }?;
    if node_key(node).is_empty() {
        return Err("chart semantic key must not be empty".to_owned());
    }
    Ok(())
}

fn validate_mask(panel_mask: u16) -> Result<(), String> {
    if panel_mask == 0 || panel_mask & !pump_chart::PANEL_MASK != 0 {
        return Err("chart panel mask is invalid".to_owned());
    }
    Ok(())
}

fn has_forward_reference(node: &Node, id: u32) -> bool {
    match node {
        Node::Tap { .. } | Node::Hold { .. } | Node::Rest { .. } => false,
        Node::Sequence { children, .. } | Node::Parallel { children, .. } => {
            children.iter().any(|child| *child >= id)
        }
        Node::Repeat { child, .. } | Node::Mirror { child, .. } => *child >= id,
        Node::Choice { branches, .. } => branches.iter().any(|branch| branch.node >= id),
    }
}

fn node_key(node: &Node) -> &str {
    match node {
        Node::Tap { key, .. }
        | Node::Hold { key, .. }
        | Node::Rest { key, .. }
        | Node::Sequence { key, .. }
        | Node::Parallel { key, .. }
        | Node::Repeat { key, .. }
        | Node::Choice { key, .. }
        | Node::Mirror { key, .. } => key,
    }
}
