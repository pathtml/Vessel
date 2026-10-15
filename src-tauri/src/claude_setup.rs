use crate::platform::{home_dir, legacy_dir, vessel_dir};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

pub const HOOK_FILE: &str = "vessel-statusline.ps1";
/// The hook script written by the previous app. Treated as "ours" so it can be taken over.
const V1_HOOK_FILE: &str = "ai-usage-dock-statusline.ps1";
const EXPORT_FILE: &str = "claude-code-usage.json";
const SCRIPT: &str = include_str!("../scripts/vessel-statusline.ps1");
const KEEP_BACKUPS: usize = 3;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectStatus {
    Connected,
    Conflict,
    NeedsSignIn,
    NotInstalled,
    Error,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub ok: bool,
    pub status: ConnectStatus,
    pub message: String,
}

impl ConnectResult {
    pub fn new(status: ConnectStatus, message: &str) -> Self {
        Self {
            ok: status == ConnectStatus::Connected,
            status,
            message: message.to_string(),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum MergeOutcome {
    Updated(Value),
    Conflict,
}

fn command_of(settings: &Value) -> Option<&str> {
    settings
        .pointer("/statusLine/command")
        .and_then(Value::as_str)
}

fn is_ours(command: &str) -> bool {
    command.contains(HOOK_FILE) || command.contains(V1_HOOK_FILE)
}

/// Adds Vessel's status line. Never overwrites someone else's unless `force` is set.
pub fn merge_statusline(
    mut settings: Value,
    command: &str,
    force: bool,
) -> Result<MergeOutcome, String> {
    if !settings.is_object() {
        return Err(
            "Claude settings are not a JSON object. Fix or reset the file, then try again.".into(),
        );
    }
    if let Some(existing) = command_of(&settings) {
        if !is_ours(existing) && !force {
            return Ok(MergeOutcome::Conflict);
        }
    }
    settings["statusLine"] = json!({
        "type": "command",
        "command": command,
        "refreshInterval": 30
    });
    Ok(MergeOutcome::Updated(settings))
}

/// Removes the status line only if it is ours. Returns whether anything was removed.
pub fn remove_statusline(mut settings: Value) -> (Value, bool) {
    let ours = command_of(&settings).is_some_and(is_ours);
    if ours {
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("statusLine");
        }
    }
    (settings, ours)
}

/// Names of old backups to delete so only the newest `keep` remain.
pub fn backups_to_delete(names: &[String], keep: usize) -> Vec<String> {
    let mut stamped: Vec<(u64, &String)> = names
        .iter()
        .filter_map(|n| Some((n.strip_prefix("settings.json.bak-")?.parse().ok()?, n)))
        .collect();
    stamped.sort_by_key(|(ts, _)| std::cmp::Reverse(*ts));
    stamped
        .into_iter()
        .skip(keep)
        .map(|(_, n)| n.clone())
        .collect()
}

fn backup_settings(settings_path: &Path) -> Result<(), String> {
    if !settings_path.exists() {
        return Ok(());
    }
    let dir = settings_path
        .parent()
        .ok_or("Invalid Claude settings path.")?;
    let stamp = crate::model::now();
    fs::copy(
        settings_path,
        dir.join(format!("settings.json.bak-{stamp}")),
    )
    .map_err(|e| format!("Could not back up Claude settings: {e}"))?;
    if let Ok(entries) = fs::read_dir(dir) {
        let names: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        for old in backups_to_delete(&names, KEEP_BACKUPS) {
            let _ = fs::remove_file(dir.join(old));
        }
    }
    Ok(())
}

fn read_settings(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let raw =
        fs::read_to_string(path).map_err(|e| format!("Could not read Claude settings: {e}"))?;
    serde_json::from_str(&raw).map_err(|_| {
        "Claude settings are not valid JSON. Fix the file, then try again.".to_string()
    })
}

fn write_settings(path: &Path, value: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Could not write Claude settings: {e}"))
}

pub fn claude_installed() -> bool {
    home_dir().is_some_and(|h| h.join(".claude").exists())
}

/// True when the previous app left traces (exports folder or its hook).
pub fn v1_found() -> bool {
    if legacy_dir().is_some_and(|d| d.exists()) {
        return true;
    }
    home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .and_then(|p| read_settings(&p).ok())
        .is_some_and(|s| command_of(&s).is_some_and(|c| c.contains(V1_HOOK_FILE)))
}

pub fn install(force: bool) -> ConnectResult {
    match try_install(force) {
        Ok(result) => result,
        Err(message) => ConnectResult::new(ConnectStatus::Error, &message),
    }
}

fn try_install(force: bool) -> Result<ConnectResult, String> {
    let home = home_dir().ok_or("Could not find your user folder.")?;
    let vessel = vessel_dir().ok_or("Could not find your user folder.")?;
    let claude_dir = home.join(".claude");
    if !claude_dir.exists() {
        return Ok(ConnectResult::new(
            ConnectStatus::NotInstalled,
            "Claude Code was not found. Install it and use it once, then scan again.",
        ));
    }

    let settings_path = claude_dir.join("settings.json");
    let settings = read_settings(&settings_path)?;

    fs::create_dir_all(&vessel).map_err(|e| format!("Could not create the Vessel folder: {e}"))?;
    let script = vessel.join(HOOK_FILE);
    let command = format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        script.display()
    );

    match merge_statusline(settings, &command, force)? {
        MergeOutcome::Conflict => Ok(ConnectResult::new(
            ConnectStatus::Conflict,
            "Claude Code already shows a different status line. Replace it? A backup is saved first.",
        )),
        MergeOutcome::Updated(updated) => {
            fs::write(&script, SCRIPT).map_err(|e| format!("Could not write the Vessel hook: {e}"))?;
            backup_settings(&settings_path)?;
            write_settings(&settings_path, &updated)?;
            Ok(ConnectResult::new(
                ConnectStatus::Connected,
                "Connected. Use Claude Code once and the numbers will appear.",
            ))
        }
    }
}

/// Undo: removes our status line (after a backup) and the exported data.
pub fn uninstall() -> Result<(), String> {
    if let Some(home) = home_dir() {
        let settings_path = home.join(".claude").join("settings.json");
        if settings_path.exists() {
            let (updated, changed) = remove_statusline(read_settings(&settings_path)?);
            if changed {
                backup_settings(&settings_path)?;
                write_settings(&settings_path, &updated)?;
            }
        }
    }
    if let Some(dir) = vessel_dir() {
        let _ = fs::remove_file(dir.join(EXPORT_FILE));
        let _ = fs::remove_file(dir.join(HOOK_FILE));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CMD: &str = "powershell -File C:/x/vessel-statusline.ps1";

    #[test]
    fn adds_to_empty_settings_and_keeps_other_keys() {
        let out = merge_statusline(json!({"theme": "dark"}), CMD, false).unwrap();
        let MergeOutcome::Updated(v) = out else {
            panic!("expected update")
        };
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["statusLine"]["command"], CMD);
    }

    #[test]
    fn does_not_overwrite_someone_elses_status_line() {
        let s = json!({"statusLine": {"type": "command", "command": "my-tool"}});
        assert_eq!(
            merge_statusline(s, CMD, false).unwrap(),
            MergeOutcome::Conflict
        );
    }

    #[test]
    fn force_replaces() {
        let s = json!({"statusLine": {"type": "command", "command": "my-tool"}});
        assert!(matches!(
            merge_statusline(s, CMD, true).unwrap(),
            MergeOutcome::Updated(_)
        ));
    }

    #[test]
    fn takes_over_the_v1_hook_without_asking() {
        let s = json!({"statusLine": {"command": "powershell -File C:/c/ai-usage-dock-statusline.ps1"}});
        assert!(matches!(
            merge_statusline(s, CMD, false).unwrap(),
            MergeOutcome::Updated(_)
        ));
    }

    #[test]
    fn rejects_non_object_settings() {
        assert!(merge_statusline(json!([1]), CMD, false).is_err());
    }

    #[test]
    fn remove_only_touches_our_hook() {
        let ours = json!({"statusLine": {"command": CMD}, "a": 1});
        let (v, changed) = remove_statusline(ours);
        assert!(changed && v.get("statusLine").is_none() && v["a"] == 1);

        let theirs = json!({"statusLine": {"command": "other"}});
        let (v, changed) = remove_statusline(theirs.clone());
        assert!(!changed);
        assert_eq!(v, theirs);
    }

    #[test]
    fn prunes_oldest_backups() {
        let names: Vec<String> = [
            "settings.json",
            "settings.json.bak-10",
            "settings.json.bak-30",
            "settings.json.bak-20",
            "settings.json.bak-40",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let mut gone = backups_to_delete(&names, 3);
        gone.sort();
        assert_eq!(gone, vec!["settings.json.bak-10"]);
    }
}
