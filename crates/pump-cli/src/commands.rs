use std::collections::BTreeSet;

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};
use wasmtime::Store;
use wasmtime::component::{Component, HasSelf, Linker};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::author_bindings::AuthorWorld;
use crate::author_host::HostState;
use crate::bundle;
use crate::cli::{Cli, Command, ComponentCommand, OutputFormat, PackageCommand};
use crate::runtime_runner::RuntimeRunner;

#[derive(Serialize)]
struct Inspection {
    imports: Vec<String>,
    exports: Vec<String>,
    runtime_compatible: bool,
    author_compatible: bool,
}

pub fn run(cli: &Cli) -> Result<()> {
    match &cli.command {
        Command::Chart(args) => crate::chart_commands::run(args, cli.format),
        Command::Component(args) => match &args.command {
            ComponentCommand::Inspect { component } => inspect(component, cli.format),
        },
        Command::Compile(args) => compile(args, cli.format),
        Command::Generate(args) => generate(args, cli.format, false),
        Command::Explain(args) => generate(args, cli.format, true),
        Command::Analyze(args) => analyze(&args.bundle, cli.format),
        Command::Verify(args) => output(&bundle::verify(&args.bundle)?, cli.format),
        Command::TestSeeds(args) => test_seeds(args, cli.format),
        Command::Package(args) => match &args.command {
            PackageCommand::Cache {
                manifest,
                lock,
                store,
            } => output(
                &crate::package_store::cache(manifest, lock, store)?,
                cli.format,
            ),
            PackageCommand::CompileLocked {
                lock,
                store,
                runtime,
                out,
            } => output(
                &crate::package_compile::compile_loaded(
                    crate::package_store::load(lock, store)?,
                    runtime,
                    out,
                )?,
                cli.format,
            ),
            PackageCommand::Resolve { manifest, out } => {
                output(&crate::package_compile::resolve(manifest, out)?, cli.format)
            }
            PackageCommand::Compile {
                manifest,
                lock,
                runtime,
                out,
            } => output(
                &crate::package_compile::compile(manifest, lock, runtime, out)?,
                cli.format,
            ),
            PackageCommand::Compatible {
                required,
                candidate,
                key,
            } => {
                crate::package_compile::compatible(required, candidate, key)?;
                output(
                    &serde_json::json!({ "compatible": true, "key": key }),
                    cli.format,
                )
            }
        },
    }
}

fn inspect(path: &std::path::Path, format: OutputFormat) -> Result<()> {
    let engine = crate::engine::engine()?;
    let bytes = artifact_io::read(path, ARTIFACT_LIMIT)?;
    let component = Component::new(&engine, &bytes)
        .with_context(|| format!("compile component {}", path.display()))?;
    let ty = component.component_type();
    let imports: Vec<String> = ty
        .imports(&engine)
        .map(|(name, _)| name.to_owned())
        .collect();
    let exports: Vec<String> = ty
        .exports(&engine)
        .map(|(name, _)| name.to_owned())
        .collect();
    let runtime_compatible = RuntimeRunner::new(&bytes).is_ok();
    let mut author_linker = Linker::<HostState>::new(&engine);
    AuthorWorld::add_to_linker::<_, HasSelf<_>>(&mut author_linker, |state| state)?;
    let mut store = Store::new(&engine, HostState::new(crate::engine::limits()));
    store.limiter(|state| &mut state.limits);
    crate::engine::fuel(&mut store)?;
    let author_compatible = imports == ["pump:author/plan-builder@0.1.0"]
        && AuthorWorld::instantiate(&mut store, &component, &author_linker).is_ok();
    output(
        &Inspection {
            imports,
            exports,
            runtime_compatible,
            author_compatible,
        },
        format,
    )
}

fn compile(args: &crate::cli::CompileArgs, format: OutputFormat) -> Result<()> {
    let engine = crate::engine::engine()?;
    let author_bytes = artifact_io::read(&args.author, ARTIFACT_LIMIT)?;
    let runtime_bytes = artifact_io::read(&args.runtime, ARTIFACT_LIMIT)?;
    let author_component =
        Component::new(&engine, &author_bytes).context("compile author component")?;
    let runtime_component =
        Component::new(&engine, &runtime_bytes).context("compile runtime component")?;
    ensure_runtime_import_free(&engine, &runtime_component)?;
    RuntimeRunner::new(&runtime_bytes)?;
    let mut linker = Linker::<HostState>::new(&engine);
    AuthorWorld::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .context("link author host API")?;
    let mut store = Store::new(&engine, HostState::new(crate::engine::limits()));
    store.limiter(|state| &mut state.limits);
    crate::engine::fuel(&mut store)?;
    let bindings = AuthorWorld::instantiate(&mut store, &author_component, &linker)
        .context("instantiate author")?;
    bindings
        .pump_author_author()
        .call_build(&mut store)
        .context("invoke author build")?
        .map_err(anyhow::Error::msg)?;
    let canonical = store.data_mut().take_plan()?;
    let runtime_plan = pump_core::compile(&canonical).context("compile canonical plan")?;
    let plan_bytes =
        pump_core::encode_runtime_plan(&runtime_plan).context("encode runtime plan")?;
    let analysis = pump_core::analyze(&runtime_plan).context("analyze runtime plan")?;
    let analysis_bytes = serde_json::to_vec_pretty(&analysis).context("encode analysis")?;
    let manifest = bundle::write(
        &args.out,
        &bundle::Artifacts {
            author: &author_bytes,
            runtime: &runtime_bytes,
            plan: &plan_bytes,
            analysis: &analysis_bytes,
            package_lock: None,
            invocation_report: None,
        },
    )?;
    output(&manifest, format)
}

fn generate(args: &crate::cli::GenerateArgs, format: OutputFormat, explain: bool) -> Result<()> {
    let bundle = bundle::load(&args.bundle)?;
    let seed = decode_seed(&args.seed)?;
    let trace = RuntimeRunner::new(&bundle.runtime)?.generate(&bundle.plan, &seed)?;
    if explain {
        output(
            &serde_json::json!({ "plan_digest": trace.plan_digest, "seed_digest": trace.seed_digest, "duration": trace.duration, "events": trace.commands }),
            format,
        )
    } else {
        #[derive(Serialize)]
        struct GeneratedChart<'a> {
            runtime_digest: &'a str,
            generated_chart_digest: String,
            #[serde(flatten)]
            trace: &'a pump_core::CommandTrace,
        }
        output(
            &GeneratedChart {
                runtime_digest: &bundle.manifest.runtime_sha256,
                generated_chart_digest: bundle::digest(&pump_core::encode_trace(&trace)?),
                trace: &trace,
            },
            format,
        )
    }
}

fn analyze(path: &std::path::Path, format: OutputFormat) -> Result<()> {
    let bundle = bundle::load(path)?;
    let analysis: pump_core::Analysis =
        serde_json::from_slice(&bundle.analysis).context("decode analysis")?;
    output(&analysis, format)
}

fn test_seeds(args: &crate::cli::TestSeedsArgs, format: OutputFormat) -> Result<()> {
    ensure!(
        args.count > 0 && args.count <= 10_000,
        "count must be between 1 and 10000"
    );
    let bundle = bundle::load(&args.bundle)?;
    let runner = RuntimeRunner::new(&bundle.runtime)?;
    let mut digests = BTreeSet::new();
    for value in 0..args.count {
        let seed = Sha256::digest(value.to_le_bytes());
        let trace = runner.generate(&bundle.plan, &seed)?;
        // Diversity concerns notes, not the seed/replay metadata.
        digests.insert(bundle::digest(&serde_json::to_vec(&trace.commands)?));
    }
    output(
        &serde_json::json!({ "count": args.count, "unique_command_traces": digests.len(), "varies": digests.len() > 1 }),
        format,
    )
}

pub(crate) fn ensure_runtime_import_free(
    engine: &wasmtime::Engine,
    component: &Component,
) -> Result<()> {
    let imports: Vec<String> = component
        .component_type()
        .imports(engine)
        .map(|(name, _)| name.to_owned())
        .collect();
    if !imports.is_empty() {
        bail!(
            "runtime component imports are forbidden: {}",
            imports.join(", ")
        );
    }
    Ok(())
}

fn decode_seed(value: &str) -> Result<Vec<u8>> {
    let seed = hex::decode(value).context("seed must be hexadecimal")?;
    ensure!(seed.len() == 32, "seed must decode to exactly 32 bytes");
    Ok(seed)
}

fn output<T: Serialize>(value: &T, format: OutputFormat) -> Result<()> {
    match format {
        OutputFormat::Json => println!(
            "{}",
            serde_json::to_string(value).context("encode JSON output")?
        ),
        OutputFormat::Text => println!(
            "{}",
            serde_json::to_string_pretty(value).context("encode output")?
        ),
    }
    Ok(())
}
