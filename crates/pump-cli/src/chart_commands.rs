use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use pump_chart::{Limits, Music};
use pump_eval::EvalContract;
use serde::Serialize;
use sha2::{Digest, Sha256};
use wasmtime::Store;
use wasmtime::component::{Component, HasSelf, Linker};

use crate::artifact_io::{self, ARTIFACT_LIMIT};
use crate::chart_author_bindings::AuthorWorld;
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
    let runtime_bytes = artifact_io::read(&args.runtime, ARTIFACT_LIMIT)?;
    let music: Music = read_json(&args.music, "music")?;
    let contract: EvalContract = read_json(&args.contract, "evaluation contract")?;
    let limits = match &args.limits {
        Some(path) => read_json(path, "compile limits")?,
        None => Limits::default(),
    };
    pump_chart::validate_limits(&limits).context("validate compile limits")?;
    pump_chart::validate_music(&music).context("validate music metadata")?;
    verify_audio(args.audio.as_deref(), &music.audio_sha256)?;
    ChartRuntime::new(&runtime_bytes)?;
    let plan = run_author(&author_bytes, music, limits)?;
    let compilation = match pump_eval::compile(&plan, &contract, &limits) {
        Ok(compilation) => compilation,
        Err(pump_eval::CompileError::NoRetainedCandidates(failed)) => {
            let path = args
                .failure_report
                .clone()
                .unwrap_or_else(|| args.out.with_extension("failure.json"));
            fs::write(
                &path,
                serde_json::to_vec_pretty(&failed).context("encode compilation failure report")?,
            )
            .with_context(|| format!("write compilation failure report {}", path.display()))?;
            bail!(
                "no candidate satisfied the evaluation contract; counterexamples: {}",
                path.display()
            );
        }
        Err(error) => return Err(error).context("evaluate chart plan"),
    };
    ensure!(
        !compilation.runtime.candidates.is_empty(),
        "evaluation retained no deployable candidates"
    );
    let plan_bytes = pump_chart::encode_plan_with_limits(&plan, &limits)
        .context("encode canonical author plan")?;
    let program_bytes =
        pump_chart::encode_runtime_program_with_limits(&compilation.runtime, &limits)
            .context("encode runtime program")?;
    let limits_bytes = serde_json::to_vec_pretty(&limits).context("encode compile limits")?;
    let contract_bytes =
        serde_json::to_vec_pretty(&contract).context("encode evaluation contract")?;
    let report_bytes =
        serde_json::to_vec_pretty(&compilation.report).context("encode compile report")?;
    let manifest = crate::chart_bundle::write(
        &args.out,
        &crate::chart_bundle::Artifacts {
            author_component: &author_bytes,
            plan: &plan_bytes,
            limits: &limits_bytes,
            contract: &contract_bytes,
            program: &program_bytes,
            runtime_component: &runtime_bytes,
            report: &report_bytes,
            audio_sha256: &hex::encode(plan.music.audio_sha256),
        },
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

fn verify_audio(path: Option<&Path>, expected: &[u8; 32]) -> Result<()> {
    if let Some(path) = path {
        let bytes = artifact_io::read(path, ARTIFACT_LIMIT)?;
        let actual: [u8; 32] = Sha256::digest(&bytes).into();
        ensure!(
            actual == *expected,
            "audio SHA-256 does not match Music metadata"
        );
    }
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path, label: &str) -> Result<T> {
    serde_json::from_slice(&artifact_io::read(path, ARTIFACT_LIMIT)?)
        .with_context(|| format!("decode {label} JSON"))
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
