use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Parser)]
#[command(
    name = "pump",
    version,
    about = "Deterministic sandboxed PUMP chart compiler"
)]
pub struct Cli {
    #[arg(long, value_enum, default_value_t = OutputFormat::Text, global = true)]
    pub format: OutputFormat,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Component(ComponentArgs),
    Compile(CompileArgs),
    Generate(GenerateArgs),
    Analyze(BundleArgs),
    Verify(BundleArgs),
    TestSeeds(TestSeedsArgs),
    Explain(GenerateArgs),
    Package(PackageArgs),
}

#[derive(Debug, Args)]
pub struct PackageArgs {
    #[command(subcommand)]
    pub command: PackageCommand,
}

#[derive(Debug, Subcommand)]
pub enum PackageCommand {
    Resolve {
        manifest: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Compile {
        manifest: PathBuf,
        #[arg(long)]
        lock: PathBuf,
        #[arg(long)]
        runtime: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Compatible {
        required: PathBuf,
        candidate: PathBuf,
        #[arg(long)]
        key: String,
    },
}

#[derive(Debug, Args)]
pub struct ComponentArgs {
    #[command(subcommand)]
    pub command: ComponentCommand,
}

#[derive(Debug, Subcommand)]
pub enum ComponentCommand {
    Inspect { component: PathBuf },
}

#[derive(Debug, Args)]
pub struct CompileArgs {
    pub author: PathBuf,
    #[arg(long)]
    pub runtime: PathBuf,
    #[arg(long)]
    pub out: PathBuf,
}

#[derive(Debug, Args)]
pub struct GenerateArgs {
    pub bundle: PathBuf,
    #[arg(long)]
    pub seed: String,
}

#[derive(Debug, Args)]
pub struct BundleArgs {
    pub bundle: PathBuf,
}

#[derive(Debug, Args)]
pub struct TestSeedsArgs {
    pub bundle: PathBuf,
    #[arg(long, default_value_t = 32)]
    pub count: u32,
}
