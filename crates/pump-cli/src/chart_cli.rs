use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};

#[derive(Debug, Args)]
pub struct ChartArgs {
    #[command(subcommand)]
    pub command: ChartCommand,
}

#[derive(Debug, Subcommand)]
pub enum ChartCommand {
    Compile(ChartCompileArgs),
    CompilePackage(ChartPackageArgs),
    CompileLocked(ChartLockedArgs),
    Generate(ChartGenerateArgs),
    Analyze(ChartBundleArgs),
    Explain(ChartGenerateArgs),
    Verify(ChartVerifyArgs),
    TestSeeds(ChartTestSeedsArgs),
    Sign(ChartSignArgs),
    Keygen(ChartKeygenArgs),
    Evaluate(ChartEvaluateArgs),
    ExportSsc(ChartExportSscArgs),
    ExportEditedSsc(ChartExportEditedSscArgs),
    ImportUcs(ChartImportUcsArgs),
    ExportUcs(ChartExportUcsArgs),
}

#[derive(Debug, Args)]
pub struct ChartCompileArgs {
    pub author: PathBuf,
    #[command(flatten)]
    pub options: ChartBuildOptions,
}

#[derive(Debug, Args)]
pub struct ChartPackageArgs {
    pub manifest: PathBuf,
    #[arg(long)]
    pub lock: PathBuf,
    #[command(flatten)]
    pub options: ChartBuildOptions,
}

#[derive(Debug, Args)]
pub struct ChartLockedArgs {
    pub lock: PathBuf,
    #[arg(long)]
    pub store: PathBuf,
    #[command(flatten)]
    pub options: ChartBuildOptions,
}

#[derive(Debug, Args)]
pub struct ChartBuildOptions {
    #[arg(long)]
    pub runtime: PathBuf,
    #[arg(long)]
    pub music: PathBuf,
    #[arg(long)]
    pub contract: PathBuf,
    #[arg(long)]
    pub limits: Option<PathBuf>,
    #[arg(long)]
    pub audio: Option<PathBuf>,
    #[arg(long)]
    pub out: PathBuf,
    #[arg(long)]
    pub failure_report: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct ChartGenerateArgs {
    pub bundle: PathBuf,
    #[arg(long)]
    pub seed: String,
    #[arg(long = "history")]
    pub history: Vec<String>,
    #[arg(long)]
    pub request_out: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct ChartBundleArgs {
    pub bundle: PathBuf,
}

#[derive(Debug, Args)]
pub struct ChartVerifyArgs {
    pub bundle: PathBuf,
    #[arg(long)]
    pub trusted_key: Option<String>,
    #[arg(long)]
    pub audio: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct ChartTestSeedsArgs {
    pub bundle: PathBuf,
    #[arg(long, default_value_t = 32)]
    pub count: u32,
}

#[derive(Debug, Args)]
pub struct ChartSignArgs {
    pub bundle: PathBuf,
    #[arg(long)]
    pub key: PathBuf,
}

#[derive(Debug, Args)]
pub struct ChartKeygenArgs {
    #[arg(long)]
    pub private: PathBuf,
    #[arg(long)]
    pub public: PathBuf,
}

#[derive(Debug, Args)]
pub struct ChartEvaluateArgs {
    pub chart: PathBuf,
    #[arg(long)]
    pub music: PathBuf,
    #[arg(long)]
    pub contract: PathBuf,
}

#[derive(Debug, Args)]
pub struct ChartExportSscArgs {
    pub bundle: PathBuf,
    #[arg(long)]
    pub seed: String,
    #[arg(long = "history")]
    pub history: Vec<String>,
    #[arg(long)]
    pub audio: PathBuf,
    #[arg(long)]
    pub out: PathBuf,
    #[arg(long)]
    pub title: String,
    #[arg(long)]
    pub artist: String,
    #[arg(long)]
    pub trusted_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct ChartExportEditedSscArgs {
    pub chart: PathBuf,
    #[arg(long)]
    pub music: PathBuf,
    #[arg(long)]
    pub audio: PathBuf,
    #[arg(long)]
    pub out: PathBuf,
    #[arg(long)]
    pub title: String,
    #[arg(long)]
    pub artist: String,
}

#[derive(Debug, Args)]
pub struct ChartImportUcsArgs {
    pub file: PathBuf,
    #[arg(long)]
    pub audio: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum UcsModeArg {
    Single,
    Double,
}

impl From<UcsModeArg> for pump_ucs::UcsMode {
    fn from(value: UcsModeArg) -> Self {
        match value {
            UcsModeArg::Single => Self::Single,
            UcsModeArg::Double => Self::Double,
        }
    }
}

#[derive(Debug, Args)]
pub struct ChartExportUcsArgs {
    pub chart: PathBuf,
    #[arg(long)]
    pub music: PathBuf,
    #[arg(long, value_enum, ignore_case = true, default_value_t = UcsModeArg::Double)]
    pub mode: UcsModeArg,
    #[arg(long)]
    pub out: PathBuf,
}
