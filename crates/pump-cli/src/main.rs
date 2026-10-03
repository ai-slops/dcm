#![forbid(unsafe_code)]

mod artifact_io;
mod artifact_store;
#[cfg(test)]
mod artifact_store_tests;
mod author_host;
mod bundle;
#[cfg(test)]
mod bundle_tests;
mod cli;
mod commands;
mod engine;
#[cfg(test)]
mod host_tests;
mod package;
mod package_abi;
mod package_budget;
#[cfg(test)]
mod package_budget_tests;
mod package_bundle;
mod package_compile;
mod package_component;
mod package_lifecycle;
mod package_operations;
#[cfg(test)]
mod package_path_tests;
mod package_registry;
mod package_session;
mod package_store;
mod package_style;
#[cfg(test)]
mod package_tests;
mod package_validation;
mod policy;
mod runtime_runner;
mod session;

use std::process::ExitCode;

use clap::Parser;
use cli::{Cli, OutputFormat};

mod author_bindings {
    wasmtime::component::bindgen!({
        path: "../../wit/author",
        world: "author-world",
        with: { "pump:author/plan-builder@0.1.0.builder": crate::author_host::HostBuilder },
        imports: { default: trappable },
    });
}

mod runtime_bindings {
    wasmtime::component::bindgen!({ path: "../../wit/runtime", world: "runtime-world" });
}

mod package_bindings {
    wasmtime::component::bindgen!({
        path: "../../wit/package",
        world: "song-world",
        with: { "pump:packages/operations@0.2.0.builder": crate::package_session::HostBuilder },
        imports: { default: trappable },
    });
}

mod pattern_bindings {
    wasmtime::component::bindgen!({
        path: "../../wit/package",
        world: "pattern-world",
        with: {
            "pump:packages/operations@0.2.0": crate::package_bindings::pump::packages::operations,
        },
        imports: { default: trappable },
    });
}

mod style_bindings {
    wasmtime::component::bindgen!({
        path: "../../wit/package",
        world: "style-world",
    });
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match commands::run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            match cli.format {
                OutputFormat::Json => eprintln!(
                    "{}",
                    serde_json::json!({ "ok": false, "error": format!("{error:#}") })
                ),
                OutputFormat::Text => eprintln!("error: {error:#}"),
            }
            ExitCode::FAILURE
        }
    }
}
