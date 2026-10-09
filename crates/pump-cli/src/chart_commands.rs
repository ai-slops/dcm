use std::path::Path;

use anyhow::{Context, Result, ensure};
use pump_chart::{Limits, Music};
use pump_eval::EvalContract;
use serde::Serialize;
use wasmtime::Store;
use wasmtime::component::{Component, HasSelf, Linker};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::chart_author_bindings::AuthorWorld;
use crate::chart_build::{self, read_json, verify_audio};
use crate::chart_cli::{ChartArgs, ChartCommand, ChartCompileArgs};
use crate::chart_host::HostState;
use crate::chart_runtime::ChartRuntime;
use crate::cli::OutputFormat;

#[derive(Serialize)]
struct Verification {
    integrity: bool,
    reproduced: bool,
    authenticity: bool,
    manifest_sha256: String,
    signer: Option<String>,
}

#[derive(Serialize)]
struct KeygenOutput<'a> {
    private: &'a Path,
    public: &'a Path,
}

pub fn run(args: &ChartArgs, format: OutputFormat) -> Result<()> {
    match &args.command {
        ChartCommand::Compile(args) => compile(args, format),
        ChartCommand::CompilePackage(args) => {
            let inputs = chart_build::load(&args.options)?;
            let source = crate::package_compile::load_source(&args.manifest, &args.lock)?;
            output(
                &crate::chart_bridge::compile(source, inputs, &args.options)?,
                format,
            )
        }
        ChartCommand::CompileLocked(args) => {
            let inputs = chart_build::load(&args.options)?;
            let source = crate::package_store::load(&args.lock, &args.store)?;
            output(
                &crate::chart_bridge::compile(source, inputs, &args.options)?,
                format,
            )
        }
        ChartCommand::Generate(args) => crate::chart_generate::generate(args, format, false),
        ChartCommand::Analyze(args) => {
            let bundle = crate::chart_bundle::load(&args.bundle)?;
            output(&bundle.report, format)
        }
        ChartCommand::Explain(args) => crate::chart_generate::generate(args, format, true),
        ChartCommand::Verify(args) => output(
            &verify(
                &args.bundle,
                args.trusted_key.as_deref(),
                args.audio.as_deref(),
            )?,
            format,
        ),
        ChartCommand::TestSeeds(args) => {
            crate::chart_generate::test_seeds(&args.bundle, args.count, format)
        }
        ChartCommand::Sign(args) => {
            verify(&args.bundle, None, None)?;
            output(
                &crate::chart_signing::sign(&args.bundle, &args.key)?,
                format,
            )
        }
        ChartCommand::Keygen(args) => {
            crate::chart_signing::keygen(&args.private, &args.public)?;
            output(
                &KeygenOutput {
                    private: &args.private,
                    public: &args.public,
                },
                format,
            )
        }
        ChartCommand::Evaluate(args) => {
            let chart: pump_chart::Chart = read_json(&args.chart, "chart")?;
            let music: Music = read_json(&args.music, "music")?;
            let contract: EvalContract = read_json(&args.contract, "evaluation contract")?;
            output(&pump_eval::assess(&chart, &music, &contract)?, format)
        }
    }
}

fn compile(args: &ChartCompileArgs, format: OutputFormat) -> Result<()> {
    let author_bytes = artifact_io::read(&args.author, ARTIFACT_LIMIT)?;
    let inputs = chart_build::load(&args.options)?;
    let plan = run_author(&author_bytes, inputs.music.clone(), inputs.limits)?;
    let manifest = chart_build::publish(
        chart_build::Source {
            plan: &plan,
            author_component: &author_bytes,
            bridge: None,
        },
        &inputs,
        &args.options,
    )?;
    output(&manifest, format)
}

fn run_author(author_bytes: &[u8], music: Music, limits: Limits) -> Result<pump_chart::Plan> {
    let engine = crate::engine::engine()?;
    let component =
        Component::new(&engine, author_bytes).context("compile chart author component")?;
    let imports: Vec<String> = component
        .component_type()
        .imports(&engine)
        .map(|(name, _)| name.to_owned())
        .collect();
    ensure!(
        imports == ["pump:chart/plan-builder@0.2.0"],
        "chart author imports are not allowlisted: {}",
        imports.join(", ")
    );
    let mut linker = Linker::<HostState>::new(&engine);
    AuthorWorld::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .context("link chart author host API")?;
    let mut store = Store::new(
        &engine,
        HostState::new(music, limits, crate::engine::limits()),
    );
    store.limiter(|state| &mut state.store_limits);
    crate::engine::fuel(&mut store)?;
    let bindings = AuthorWorld::instantiate(&mut store, &component, &linker)
        .context("instantiate chart author")?;
    bindings
        .pump_chart_author()
        .call_build(&mut store)
        .context("invoke chart author build")?
        .map_err(anyhow::Error::msg)?;
    store.data_mut().take_plan()
}

fn verify(root: &Path, trusted_key: Option<&str>, audio: Option<&Path>) -> Result<Verification> {
    let bundle = crate::chart_bundle::load(root)?;
    ChartRuntime::new(&bundle.runtime_component)?;
    verify_audio(audio, &bundle.plan.music.audio_sha256)?;
    pump_eval::reproduce(
        &bundle.plan,
        &bundle.contract,
        &bundle.limits,
        &bundle.program,
        &bundle.report,
    )
    .context("reproduce chart evaluation")?;
    let signature = trusted_key
        .map(|key| crate::chart_signing::verify(root, key))
        .transpose()?;
    Ok(Verification {
        integrity: true,
        reproduced: true,
        authenticity: signature.is_some(),
        manifest_sha256: crate::chart_bundle::digest(&bundle.manifest_bytes),
        signer: signature.map(|record| record.public_key),
    })
}

pub(crate) fn output<T: Serialize>(value: &T, format: OutputFormat) -> Result<()> {
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
