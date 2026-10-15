pub mod claude;
pub mod codex;
pub mod gemini;

use crate::model::{Health, UsageSnapshot};

/// Static dispatch over the providers. Each provider keeps its details in its own file.
pub enum AnyProvider {
    Codex(codex::Codex),
    Claude(claude::Claude),
    Gemini(gemini::Gemini),
}

impl AnyProvider {
    pub fn all() -> Vec<AnyProvider> {
        vec![
            AnyProvider::Codex(codex::Codex),
            AnyProvider::Claude(claude::Claude),
            AnyProvider::Gemini(gemini::Gemini),
        ]
    }

    pub fn id(&self) -> &'static str {
        match self {
            AnyProvider::Codex(_) => "codex",
            AnyProvider::Claude(_) => "claude",
            AnyProvider::Gemini(_) => "gemini",
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            AnyProvider::Codex(_) => "Codex",
            AnyProvider::Claude(_) => "Claude",
            AnyProvider::Gemini(_) => "Gemini",
        }
    }

    /// Gemini has no data source yet, so it never needs connecting.
    pub fn needs_connect(&self) -> bool {
        !matches!(self, AnyProvider::Gemini(_))
    }

    /// Row shown for a provider the user has not connected. Nothing is read or fetched for it.
    pub fn not_connected(&self) -> UsageSnapshot {
        UsageSnapshot::new(
            self.id(),
            self.name(),
            Health::NotConnected,
            Some("Connect this provider to see its limits.".into()),
        )
    }

    pub async fn fetch(&self) -> UsageSnapshot {
        match self {
            AnyProvider::Codex(p) => p.fetch().await,
            AnyProvider::Claude(p) => p.fetch().await,
            AnyProvider::Gemini(p) => p.fetch().await,
        }
    }
}
