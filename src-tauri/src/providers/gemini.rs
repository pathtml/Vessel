use crate::model::{Health, UsageSnapshot};

pub struct Gemini;

impl Gemini {
    /// No documented quota source exists yet (phase 0 spike), so this is a placeholder row.
    pub async fn fetch(&self) -> UsageSnapshot {
        UsageSnapshot::new(
            "gemini",
            "Gemini",
            Health::ComingSoon,
            Some("Gemini app usage cannot be read automatically yet.".into()),
        )
    }
}
