#![forbid(unsafe_code)]

mod artifact_io;
mod author_host;
mod bundle;
mod cli;
mod commands;
mod engine;
#[cfg(test)]
mod host_tests;
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

fn main() -> ExitCode {
    let cli = Cli::parse();
    match commands::run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            match cli.format {
                OutputFormat::Json => eprintln!(
                    "{}",
                    serde_json::json!({ "ok": false, "error": error.to_string() })
                ),
                OutputFormat::Text => eprintln!("error: {error:#}"),
            }
            ExitCode::FAILURE
        }
    }
}
