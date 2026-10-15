use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const REFRESH_CHOICES: [u32; 4] = [1, 5, 15, 30];

/// What the user has agreed to and chosen. Stored as JSON in the app data folder.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub consent_accepted: bool,
    pub onboarding_done: bool,
    pub connected: Vec<String>,
    pub open_at_login: bool,
    pub alerts_enabled: bool,
    /// Warn when a limit drops to this many percent left. (5% always warns as "almost out".)
    pub low_threshold: u32,
    /// Quiet hours in local time, 0-23. Both must be set for quiet hours to apply.
    pub quiet_start: Option<u8>,
    pub quiet_end: Option<u8>,
    pub refresh_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            consent_accepted: false,
            onboarding_done: false,
            connected: Vec::new(),
            open_at_login: false,
            alerts_enabled: true,
            low_threshold: 20,
            quiet_start: None,
            quiet_end: None,
            refresh_minutes: 5,
        }
    }
}

impl Settings {
    pub fn load(path: Option<&Path>) -> Self {
        path.and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .map(Settings::sanitized)
            .unwrap_or_default()
    }

    pub fn save(&self, path: Option<&PathBuf>) {
        let Some(path) = path else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn is_connected(&self, id: &str) -> bool {
        self.connected.iter().any(|c| c == id)
    }

    pub fn set_connected(&mut self, id: &str, connected: bool) {
        self.connected.retain(|c| c != id);
        if connected {
            self.connected.push(id.to_string());
        }
    }

    /// Keeps hand-edited or out-of-range values usable.
    pub fn sanitized(mut self) -> Self {
        self.low_threshold = self.low_threshold.clamp(10, 50);
        if !REFRESH_CHOICES.contains(&self.refresh_minutes) {
            self.refresh_minutes = 5;
        }
        if self.quiet_start.is_some_and(|h| h > 23) || self.quiet_end.is_some_and(|h| h > 23) {
            self.quiet_start = None;
            self.quiet_end = None;
        }
        self
    }

    /// Copies only the fields the settings screen may change. Consent, onboarding and
    /// connections can never be altered through this path.
    pub fn apply_user_edits(&mut self, edits: &Settings) {
        let edits = edits.clone().sanitized();
        self.open_at_login = edits.open_at_login;
        self.alerts_enabled = edits.alerts_enabled;
        self.low_threshold = edits.low_threshold;
        self.quiet_start = edits.quiet_start;
        self.quiet_end = edits.quiet_end;
        self.refresh_minutes = edits.refresh_minutes;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_and_disconnect() {
        let mut s = Settings::default();
        s.set_connected("codex", true);
        s.set_connected("codex", true);
        assert_eq!(s.connected, vec!["codex"]);
        assert!(s.is_connected("codex"));
        s.set_connected("codex", false);
        assert!(!s.is_connected("codex"));
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let s: Settings = serde_json::from_str(r#"{"consentAccepted": true}"#).unwrap();
        assert!(s.consent_accepted);
        assert!(!s.onboarding_done);
        assert!(s.alerts_enabled);
        assert_eq!(s.low_threshold, 20);
        assert_eq!(s.refresh_minutes, 5);
    }

    #[test]
    fn out_of_range_values_are_repaired() {
        let s = Settings {
            low_threshold: 99,
            refresh_minutes: 7,
            quiet_start: Some(30),
            quiet_end: Some(2),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.low_threshold, 50);
        assert_eq!(s.refresh_minutes, 5);
        assert_eq!((s.quiet_start, s.quiet_end), (None, None));
    }

    #[test]
    fn user_edits_cannot_touch_consent_or_connections() {
        let mut current = Settings {
            consent_accepted: true,
            connected: vec!["codex".into()],
            ..Settings::default()
        };
        let edits = Settings {
            consent_accepted: false,
            onboarding_done: true,
            connected: vec![],
            low_threshold: 30,
            ..Settings::default()
        };
        current.apply_user_edits(&edits);
        assert!(current.consent_accepted);
        assert!(!current.onboarding_done);
        assert_eq!(current.connected, vec!["codex"]);
        assert_eq!(current.low_threshold, 30);
    }
}
