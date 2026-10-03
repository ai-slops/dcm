use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct ChartArgs {
    #[command(subcommand)]
    pub command: ChartCommand,
}

#[derive(Debug, Subcommand)]
pub enum ChartCommand {
    Compile(ChartCompileArgs),
    Generate(ChartGenerateArgs),
    Analyze(ChartBundleArgs),
    Explain(ChartGenerateArgs),
    Verify(ChartVerifyArgs),
    TestSeeds(ChartTestSeedsArgs),
    Sign(ChartSignArgs),
    Keygen(ChartKeygenArgs),
    Evaluate(ChartEvaluateArgs),
}

#[derive(Debug, Args)]
pub struct ChartCompileArgs {
    pub author: PathBuf,
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
