use std::sync::{Arc, Mutex};

use anyhow::Context;
use pump_core::Limits;
use wasmtime::component::Resource;

use crate::package_bindings::pump::packages::lifecycle;
use crate::package_session::{BuilderSession, HostBuilder, PackageState, lock};

impl lifecycle::Host for PackageState {
    fn create(
        &mut self,
        max_nodes: u32,
        max_expansions: u32,
    ) -> wasmtime::Result<Resource<HostBuilder>> {
        let defaults = Limits::default();
        let limits = Limits {
            max_nodes: max_nodes.min(defaults.max_nodes),
            max_expansions: max_expansions.min(defaults.max_expansions),
            ..defaults
        };
        let mut existing = lock(&self.shared)?;
        existing.start_builder(limits)?;
        drop(existing);
        let registry = self
            .registry
            .as_ref()
            .context("song registry is unavailable")?;
        let song = registry.song_entry()?;
        let provenance = format!("pkg:{}:{}:build", song.key, song.sha256);
        self.table
            .push(HostBuilder::parent(
                Arc::clone(&self.shared),
                format!("song:{}", song.sha256),
                provenance,
            ))
            .context("allocate song builder")
    }

    fn finish(
        &mut self,
        resource: Resource<HostBuilder>,
        root: u32,
    ) -> wasmtime::Result<Result<(), String>> {
        let builder = self.table.get(&resource)?;
        lock(&builder.shared)?.charge_hostcall()?;
        if !builder.can_finish {
            return Ok(Err("child builder cannot finalize a plan".to_owned()));
        }
        let node = match builder.resolve(root) {
            Ok(node) => node,
            Err(error) => return Ok(Err(error.to_string())),
        };
        let mut session = lock(&builder.shared)?;
        if session.poisoned {
            return Ok(Err("builder session is poisoned".to_owned()));
        }
        let result = session
            .builder
            .take()
            .context("builder already finished")?
            .finish(node);
        match result {
            Ok(plan) => {
                session.plan = Some(plan);
                Ok(Ok(()))
            }
            Err(error) => {
                session.poisoned = true;
                Ok(Err(error.to_string()))
            }
        }
    }
}

pub fn empty_session() -> Arc<Mutex<BuilderSession>> {
    let mut session = BuilderSession::new(Limits::default());
    session.builder = None;
    Arc::new(Mutex::new(session))
}
