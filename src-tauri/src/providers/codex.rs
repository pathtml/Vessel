use crate::model::{now, Health, UsageSnapshot, UsageWindow};
use crate::platform::home_dir;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

const ID: &str = "codex";
const NAME: &str = "Codex";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

pub struct Codex;

impl Codex {
    pub async fn fetch(&self) -> UsageSnapshot {
        let Some(path) = auth_path() else {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::NotConnected,
                Some("Codex login not found. Sign in to Codex first.".into()),
            );
        };
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => {
                return UsageSnapshot::new(
                    ID,
                    NAME,
                    Health::SignInAgain,
                    Some("Cannot read the Codex login file.".into()),
                )
            }
        };
        let Some((token, account)) = parse_auth(&raw) else {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::SignInAgain,
                Some("Codex login is incomplete. Sign in again.".into()),
            );
        };

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("codex-cli")
            .build()
        {
            Ok(client) => client,
            Err(_) => {
                return UsageSnapshot::new(
                    ID,
                    NAME,
                    Health::Offline,
                    Some("Could not start a network client.".into()),
                )
            }
        };

        let response = client
            .get(USAGE_URL)
            .bearer_auth(token)
            .header("ChatGPT-Account-Id", account)
            .header("Accept", "application/json")
            .send()
            .await;
        let response = match response {
            Ok(r) => r,
            Err(_) => {
                return UsageSnapshot::new(
                    ID,
                    NAME,
                    Health::Offline,
                    Some("Could not reach Codex.".into()),
                )
            }
        };

        let status = response.status().as_u16();
        match status {
            401 | 403 => {
                return UsageSnapshot::new(
                    ID,
                    NAME,
                    Health::SignInAgain,
                    Some("Codex rejected the saved login.".into()),
                )
            }
            500..=599 => {
                return UsageSnapshot::new(
                    ID,
                    NAME,
                    Health::Offline,
                    Some("Codex is having problems.".into()),
                )
            }
            s if !(200..300).contains(&s) => {
                return UsageSnapshot::new(
                    ID,
                    NAME,
                    Health::SourceChanged,
                    Some(format!("Unexpected answer (HTTP {s}).")),
                )
            }
            _ => {}
        }

        let Ok(body) = response.json::<Value>().await else {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::SourceChanged,
                Some("Unreadable answer from Codex.".into()),
            );
        };
        let windows = parse_usage(&body, now());
        if windows.is_empty() {
            return UsageSnapshot::new(
                ID,
                NAME,
                Health::SourceChanged,
                Some("Codex answer had no usage windows.".into()),
            );
        }
        UsageSnapshot::ok(ID, NAME, windows)
    }
}

fn auth_path() -> Option<PathBuf> {
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let path = PathBuf::from(codex_home).join("auth.json");
        if path.exists() {
            return Some(path);
        }
    }
    let path = home_dir()?.join(".codex").join("auth.json");
    path.exists().then_some(path)
}

#[derive(Debug, PartialEq, Eq)]
pub enum LoginStatus {
    Missing,
    Incomplete,
    Ready,
}

pub fn login_status() -> LoginStatus {
    let Some(path) = auth_path() else {
        return LoginStatus::Missing;
    };
    match std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| parse_auth(&raw))
    {
        Some(_) => LoginStatus::Ready,
        None => LoginStatus::Incomplete,
    }
}

/// Returns (access_token, account_id). Never logs either.
fn parse_auth(raw: &str) -> Option<(String, String)> {
    let auth: Value = serde_json::from_str(raw).ok()?;
    let pick = |pointer: &str| {
        auth.pointer(pointer)
            .and_then(Value::as_str)
            .filter(|v| !v.trim().is_empty())
            .map(str::to_string)
    };
    Some((pick("/tokens/access_token")?, pick("/tokens/account_id")?))
}

/// Every window is optional: only the ones that exist and carry a percentage are returned.
fn parse_usage(body: &Value, now: i64) -> Vec<UsageWindow> {
    [
        ("5h", "/rate_limit/primary_window"),
        ("weekly", "/rate_limit/secondary_window"),
    ]
    .iter()
    .filter_map(|(label, pointer)| parse_window(label, body.pointer(pointer)?, now))
    .collect()
}

fn parse_window(label: &str, window: &Value, now: i64) -> Option<UsageWindow> {
    let used = window.get("used_percent")?.as_f64()?;
    let resets_at = window.get("reset_at").and_then(Value::as_i64).or_else(|| {
        window
            .get("reset_after_seconds")
            .and_then(Value::as_i64)
            .map(|s| now + s)
    });
    Some(UsageWindow::from_used(label, used, resets_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_both_windows() {
        let body = json!({"rate_limit": {
            "primary_window": {"used_percent": 20, "reset_at": 1000},
            "secondary_window": {"used_percent": 55.4, "reset_after_seconds": 60}
        }});
        let w = parse_usage(&body, 500);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].remaining_pct, 80);
        assert_eq!(w[0].resets_at, Some(1000));
        assert_eq!(w[1].used_pct, 55);
        assert_eq!(w[1].resets_at, Some(560));
    }

    #[test]
    fn missing_or_empty_weekly_window_is_skipped() {
        let body = json!({"rate_limit": {
            "primary_window": {"used_percent": 10},
            "secondary_window": {}
        }});
        let w = parse_usage(&body, 0);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].label, "5h");
    }

    #[test]
    fn unknown_shape_gives_no_windows() {
        assert!(parse_usage(&json!({"hello": 1}), 0).is_empty());
    }

    #[test]
    fn clamps_percentages() {
        let body = json!({"rate_limit": {"primary_window": {"used_percent": 250}}});
        assert_eq!(parse_usage(&body, 0)[0].remaining_pct, 0);
    }

    #[test]
    fn auth_needs_token_and_account() {
        assert!(parse_auth(r#"{"tokens":{"access_token":"a","account_id":"b"}}"#).is_some());
        assert!(parse_auth(r#"{"tokens":{"access_token":"a"}}"#).is_none());
        assert!(parse_auth("not json").is_none());
    }
}
