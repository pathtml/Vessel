use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// What the user should be told about a provider. Maps 1:1 to the badges in the flow doc.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    Ok,
    SignInAgain,
    Offline,
    SourceChanged,
    WaitingForFirstUse,
    NotConnected,
    ComingSoon,
}

impl Health {
    /// Problems that deserve a warning badge on the tray icon.
    pub fn is_problem(self) -> bool {
        matches!(
            self,
            Health::SignInAgain | Health::Offline | Health::SourceChanged
        )
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    pub used_pct: u32,
    pub remaining_pct: u32,
    /// Unix seconds.
    pub resets_at: Option<i64>,
}

impl UsageWindow {
    pub fn from_used(label: &str, used: f64, resets_at: Option<i64>) -> Self {
        let used_pct = used.round().clamp(0.0, 100.0) as u32;
        Self {
            label: label.to_string(),
            used_pct,
            remaining_pct: 100 - used_pct,
            resets_at,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub provider: String,
    pub display_name: String,
    pub windows: Vec<UsageWindow>,
    pub fetched_at: i64,
    pub health: Health,
    pub message: Option<String>,
}

impl UsageSnapshot {
    pub fn new(
        provider: &str,
        display_name: &str,
        health: Health,
        message: Option<String>,
    ) -> Self {
        Self {
            provider: provider.to_string(),
            display_name: display_name.to_string(),
            windows: Vec::new(),
            fetched_at: now(),
            health,
            message,
        }
    }

    pub fn ok(provider: &str, display_name: &str, windows: Vec<UsageWindow>) -> Self {
        let mut snap = Self::new(provider, display_name, Health::Ok, None);
        snap.windows = windows;
        snap
    }

    /// Lowest remaining percentage across this provider's windows.
    pub fn lowest_remaining(&self) -> Option<u32> {
        self.windows.iter().map(|w| w.remaining_pct).min()
    }
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
