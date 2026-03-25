use clap::{Parser, Subcommand};
use indicatif::ProgressBar;
use std::thread;
use std::time::Duration;

#[derive(Parser)]
#[command(name = "fluid-cli")]
#[command(author = "Victor Okeke")]
#[command(version = "0.1.0")]
#[command(about = "CLI tool to manage the Fluid server", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show server status
    Status,
    /// Fund a specific account
    Fund { account: String },
    /// Generate new keys
    GenerateKeys,
    /// Check balance of an account
    CheckBalance { account: String },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Status => {
            println!("Server is running fine!");
        }

        Commands::Fund { account } => {
            let pb = ProgressBar::new(100);
            println!("Funding account: {}", account);

            // Simulate a long task
            for _ in 0..100 {
                pb.inc(1);
                thread::sleep(Duration::from_millis(20));
            }

            pb.finish_with_message("Funding completed");
        }

        Commands::GenerateKeys => {
            println!("New keys generated!");
        }

        Commands::CheckBalance { account } => {
            println!("Balance for {}: 1000 tokens", account);
        }
    } // <-- closes the match
} // <-- closes main