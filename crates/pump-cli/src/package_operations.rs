use anyhow::{Context, Result, ensure};
use pump_core::NodeId;
use wasmtime::component::Resource;

use crate::package_bindings::pump::packages::operations::{self, WeightedNode};
use crate::package_session::{HostBuilder, PackageState, lock};

impl operations::Host for PackageState {}

impl operations::HostBuilder for PackageState {
    fn tap(
        &mut self,
        resource: Resource<HostBuilder>,
        mask: u16,
        duration: u32,
        stable_id: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        lock(&self.shared)?.charge_hostcall()?;
        Ok(self
            .mutate(&resource, &stable_id, |builder, id, provenance| {
                builder.tap(mask, duration, id, provenance)
            })
            .map_err(|error| error.to_string()))
    }

    fn sequence(
        &mut self,
        resource: Resource<HostBuilder>,
        children: Vec<u32>,
        stable_id: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        lock(&self.shared)?.charge_hostcall()?;
        ensure!(children.len() <= 4096, "collection edge budget exceeded");
        let resource_value = self.table.get(&resource)?;
        let nodes = children
            .into_iter()
            .map(|node| resource_value.resolve(node))
            .collect::<Result<Vec<_>>>()?;
        Ok(self
            .mutate(&resource, &stable_id, |builder, id, provenance| {
                builder.sequence(&nodes, id, provenance)
            })
            .map_err(|error| error.to_string()))
    }

    fn mirror(
        &mut self,
        resource: Resource<HostBuilder>,
        child: u32,
        stable_id: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        lock(&self.shared)?.charge_hostcall()?;
        let node = self.table.get(&resource)?.resolve(child)?;
        Ok(self
            .mutate(&resource, &stable_id, |builder, id, provenance| {
                builder.mirror(node, id, provenance)
            })
            .map_err(|error| error.to_string()))
    }

    fn choice(
        &mut self,
        resource: Resource<HostBuilder>,
        alternatives: Vec<WeightedNode>,
        duration: Option<u32>,
        stable_id: String,
    ) -> wasmtime::Result<Result<u32, String>> {
        lock(&self.shared)?.charge_hostcall()?;
        ensure!(alternatives.len() <= 4096, "choice edge budget exceeded");
        let resource_value = self.table.get(&resource)?;
        let nodes = alternatives
            .into_iter()
            .map(|item| Ok((item.weight, resource_value.resolve(item.node)?)))
            .collect::<Result<Vec<_>>>()?;
        Ok(self
            .mutate(&resource, &stable_id, |builder, id, provenance| {
                builder.choice(&nodes, duration, id, provenance)
            })
            .map_err(|error| error.to_string()))
    }

    fn drop(&mut self, resource: Resource<HostBuilder>) -> wasmtime::Result<()> {
        self.table
            .delete(resource)
            .map(|_| ())
            .context("drop package builder")
    }
}

impl PackageState {
    fn mutate(
        &mut self,
        resource: &Resource<HostBuilder>,
        stable_id: &str,
        operation: impl FnOnce(
            &mut pump_core::Builder,
            &str,
            &str,
        ) -> Result<NodeId, pump_core::PlanError>,
    ) -> Result<u32> {
        let resource_value = self.table.get(resource)?;
        let id = resource_value.id(stable_id)?;
        let provenance = resource_value.provenance.clone();
        let shared = resource_value.shared.clone();
        let mut session = lock(&shared)?;
        let node = operation(
            session
                .builder
                .as_mut()
                .context("builder already finished")?,
            &id,
            &provenance,
        )?;
        drop(session);
        self.table.get_mut(resource)?.alias(node)
    }
}
