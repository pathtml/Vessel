use crate::model::{Health, UsageSnapshot, UsageWindow};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// At or below this many percent left, the warning is "almost out".
const CRITICAL: u32 = 5;
/// A new reset time must be later than the old one by this much to count as a reset.
const RESET_MARGIN_SECS: i64 = 60;
/// Without reset times, a usage drop of at least this many points counts as a reset.
const RESET_DROP_POINTS: u32 = 10;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Mark {
    /// 0 = fine, 1 = low, 2 = almost out.
    level: u8,
    resets_at: Option<i64>,
    last_used: u32,
}

#[derive(Debug, PartialEq)]
pub struct Alert {
    pub title: String,
    pub body: String,
}

/// Remembers what we already warned about, so each limit window warns once per level.
/// Saved to disk so a restart does not repeat old warnings.
#[derive(Serialize, Deserialize, Default)]
pub struct AlertState {
    windows: BTreeMap<String, Mark>,
    #[serde(skip)]
    path: Option<PathBuf>,
}

impl AlertState {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut state: AlertState = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        state.path = path;
        state
    }

    pub fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(self) {
            let _ = std::fs::write(path, json);
        }
    }

    /// Looks at fresh snapshots and returns the alerts to show. Only healthy providers are
    /// considered, so stale offline numbers never trigger a warning.
    pub fn evaluate(&mut self, snapshots: &[UsageSnapshot], low: u32) -> Vec<Alert> {
        let mut alerts = Vec::new();
        for snap in snapshots.iter().filter(|s| s.health == Health::Ok) {
            for window in &snap.windows {
                let key = format!("{}/{}", snap.provider, window.label);
                let first_sight = !self.windows.contains_key(&key);
                let mark = self.windows.entry(key).or_insert_with(|| Mark {
                    level: 0,
                    resets_at: window.resets_at,
                    last_used: window.used_pct,
                });

                if !first_sight && has_reset(mark, window) {
                    // Only worth a toast if the user was told it was running low.
                    if mark.level > 0 {
                        alerts.push(Alert {
                            title: format!("{} limit has reset", snap.display_name),
                            body: format!(
                                "Your {} is back to {}% left.",
                                window_name(&window.label),
                                window.remaining_pct
                            ),
                        });
                    }
                    mark.level = 0;
                }

                let level = level_for(window.remaining_pct, low);
                if level > mark.level {
                    alerts.push(low_alert(&snap.display_name, window, level));
                }
                mark.level = level;
                mark.resets_at = window.resets_at;
                mark.last_used = window.used_pct;
            }
        }
        alerts
    }
}

fn level_for(remaining: u32, low: u32) -> u8 {
    if remaining <= CRITICAL {
        2
    } else if remaining <= low {
        1
    } else {
        0
    }
}

fn has_reset(mark: &Mark, window: &UsageWindow) -> bool {
    match (mark.resets_at, window.resets_at) {
        (Some(old), Some(new)) => new > old + RESET_MARGIN_SECS,
        _ => window.used_pct + RESET_DROP_POINTS <= mark.last_used,
    }
}

fn window_name(label: &str) -> &str {
    match label {
        "5h" => "5-hour limit",
        "weekly" => "weekly limit",
        "daily" => "daily limit",
        other => other,
    }
}

fn low_alert(name: &str, window: &UsageWindow, level: u8) -> Alert {
    let title = if level >= 2 {
        format!("{name} is almost out")
    } else {
        format!("{name} is running low")
    };
    Alert {
        title,
        body: format!(
            "{}% left of your {}.",
            window.remaining_pct,
            window_name(&window.label)
        ),
    }
}

/// Quiet hours are `[start, end)` in local hours and may wrap past midnight (22 to 7).
pub fn in_quiet_hours(hour: u8, start: Option<u8>, end: Option<u8>) -> bool {
    let (Some(start), Some(end)) = (start, end) else {
        return false;
    };
    if start == end {
        return false;
    }
    if start < end {
        hour >= start && hour < end
    } else {
        hour >= start || hour < end
    }
}

pub fn local_hour() -> u8 {
    time::OffsetDateTime::now_local()
        .unwrap_or_else(|_| time::OffsetDateTime::now_utc())
        .hour()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(remaining: u32, resets_at: Option<i64>) -> UsageSnapshot {
        UsageSnapshot::ok(
            "claude",
            "Claude",
            vec![UsageWindow::from_used(
                "5h",
                (100 - remaining) as f64,
                resets_at,
            )],
        )
    }

    #[test]
    fn warns_once_when_crossing_low() {
        let mut s = AlertState::default();
        assert!(s.evaluate(&[snap(50, Some(1000))], 20).is_empty());
        let a = s.evaluate(&[snap(18, Some(1000))], 20);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].title, "Claude is running low");
        assert!(s.evaluate(&[snap(17, Some(1000))], 20).is_empty());
    }

    #[test]
    fn critical_warns_again_after_low() {
        let mut s = AlertState::default();
        s.evaluate(&[snap(18, Some(1000))], 20);
        let a = s.evaluate(&[snap(4, Some(1000))], 20);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].title, "Claude is almost out");
    }

    #[test]
    fn reset_after_a_warning_notifies_and_rearms() {
        let mut s = AlertState::default();
        s.evaluate(&[snap(10, Some(1000))], 20);
        let a = s.evaluate(&[snap(100, Some(19000))], 20);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].title, "Claude limit has reset");
        // Drops low again in the new window: warns again.
        assert_eq!(s.evaluate(&[snap(15, Some(19000))], 20).len(), 1);
    }

    #[test]
    fn reset_without_a_prior_warning_is_silent() {
        let mut s = AlertState::default();
        s.evaluate(&[snap(60, Some(1000))], 20);
        assert!(s.evaluate(&[snap(100, Some(19000))], 20).is_empty());
    }

    #[test]
    fn reset_is_detected_from_usage_drop_when_no_reset_time() {
        let mut s = AlertState::default();
        s.evaluate(&[snap(10, None)], 20);
        let a = s.evaluate(&[snap(95, None)], 20);
        assert_eq!(a[0].title, "Claude limit has reset");
    }

    #[test]
    fn unhealthy_providers_never_alert() {
        let mut s = AlertState::default();
        let mut offline = snap(2, Some(1));
        offline.health = Health::Offline;
        assert!(s.evaluate(&[offline], 20).is_empty());
    }

    #[test]
    fn already_low_on_first_sight_warns_once() {
        let mut s = AlertState::default();
        assert_eq!(s.evaluate(&[snap(12, Some(1000))], 20).len(), 1);
        assert!(s.evaluate(&[snap(12, Some(1000))], 20).is_empty());
    }

    #[test]
    fn quiet_hours_including_wrap_past_midnight() {
        assert!(in_quiet_hours(23, Some(22), Some(7)));
        assert!(in_quiet_hours(3, Some(22), Some(7)));
        assert!(!in_quiet_hours(12, Some(22), Some(7)));
        assert!(in_quiet_hours(13, Some(12), Some(14)));
        assert!(!in_quiet_hours(14, Some(12), Some(14)));
        assert!(!in_quiet_hours(5, None, Some(7)));
        assert!(!in_quiet_hours(5, Some(4), Some(4)));
    }
}
