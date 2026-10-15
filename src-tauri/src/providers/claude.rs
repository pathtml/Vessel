use crate::model::{Health, UsageSnapshot, UsageWindow};
use crate::platform::{legacy_dir, vessel_dir};
use serde_json::Value;
use std::path::PathBuf;

const ID: &str = "claude";
const NAME: &str = "Claude";
const EXPORT_FILE: &str = "claude-code-usage.json";

pub struct Claude;

impl Claude {
    pub async fn fetch(&self) -> UsageSnapshot {
        let Some(path) = export_path() else {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::NotConnected,
                Some("Press Connect to let Vessel read Claude usage.".into()),
            );
        };
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::SourceChanged,
                Some("Cannot read the Claude usage file.".into()),
            );
        };
        let Ok(payload) = serde_json::from_str::<Value>(&raw) else {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::SourceChanged,
                Some("Claude usage file is not valid.".into()),
            );
        };
        let windows = parse_export(&payload);
        if windows.is_empty() {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::WaitingForFirstUse,
                Some("Use Claude Code once and Vessel will pick it up.".into()),
            );
        }
        UsageSnapshot::ok(ID, NAME, windows)
    }
}

fn export_path() -> Option<PathBuf> {
    [vessel_dir(), legacy_dir()]
        .into_iter()
        .flatten()
        .map(|dir| dir.join(EXPORT_FILE))
        .find(|path| path.exists())
}

fn parse_export(payload: &Value) -> Vec<UsageWindow> {
    [
        ("5h", "/rate_limits/five_hour"),
        ("weekly", "/rate_limits/seven_day"),
    ]
    .iter()
    .filter_map(|(label, pointer)| {
        let window = payload.pointer(pointer)?;
        let used = window
            .get("used_percentage")
            .or_else(|| window.get("usedPercentage"))
            .and_then(Value::as_f64)?;
        let resets_at = ["resets_at", "resetsAt", "reset_at", "resetAt"]
            .iter()
            .find_map(|key| window.get(*key))
            .and_then(|v| v.as_i64().or_else(|| v.as_str()?.trim().parse().ok()));
        Some(UsageWindow::from_used(label, used, resets_at))
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_hook_export() {
        let p = json!({"rate_limits": {
            "five_hour": {"used_percentage": 42, "resets_at": 1700},
            "seven_day": {"usedPercentage": 7, "resetsAt": "1800"}
        }});
        let w = parse_export(&p);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].remaining_pct, 58);
        assert_eq!(w[1].resets_at, Some(1800));
    }

    #[test]
    fn export_without_rate_limits_is_empty() {
        assert!(parse_export(&json!({"source": "x", "rate_limits": {}})).is_empty());
    }
}
