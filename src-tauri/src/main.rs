#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::process::Command;
use std::time::{Duration, UNIX_EPOCH};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};

const CREDENTIAL_SERVICE: &str = "Ai Usage Dock";
const LEGACY_CREDENTIAL_SERVICE: &str = "LLM Token Meter";
const TRAY_ID: &str = "main-tray";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Serialize)]
struct LocalUsageWindow {
    label: String,
    used_percent: u32,
    remaining_percent: u32,
    reset_at: Option<String>,
    limit_window_seconds: Option<u64>,
}

#[derive(Serialize)]
struct LocalUsageResponse {
    status: String,
    source: String,
    fetched_at: String,
    plan_type: Option<String>,
    message: Option<String>,
    windows: Vec<LocalUsageWindow>,
}

#[tauri::command]
fn set_api_key(storage_key: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key cannot be empty.".into());
    }
    let entry = Entry::new(CREDENTIAL_SERVICE, &storage_key).map_err(|err| err.to_string())?;
    entry
        .set_password(&api_key)
        .map_err(|err| format!("Unable to store API key securely: {err}"))
}

#[tauri::command]
fn has_api_key(storage_key: String) -> Result<bool, String> {
    let entry = Entry::new(CREDENTIAL_SERVICE, &storage_key).map_err(|err| err.to_string())?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(_) => {
            let legacy_entry = Entry::new(LEGACY_CREDENTIAL_SERVICE, &storage_key)
                .map_err(|err| err.to_string())?;
            match legacy_entry.get_password() {
                Ok(api_key) => {
                    entry
                        .set_password(&api_key)
                        .map_err(|err| format!("Unable to migrate API key securely: {err}"))?;
                    Ok(true)
                }
                Err(_) => Ok(false),
            }
        }
    }
}

#[tauri::command]
fn remove_api_key(storage_key: String) -> Result<(), String> {
    let entry = Entry::new(CREDENTIAL_SERVICE, &storage_key).map_err(|err| err.to_string())?;
    let _ = entry.delete_credential();
    if let Ok(legacy_entry) = Entry::new(LEGACY_CREDENTIAL_SERVICE, &storage_key) {
        let _ = legacy_entry.delete_credential();
    }
    Ok(())
}

#[tauri::command]
fn sync_codex_usage() -> Result<LocalUsageResponse, String> {
    let fetched_at = unix_seconds_to_iso(current_unix_seconds());
    let auth_path = find_codex_auth_path()
        .ok_or_else(|| "Codex auth file was not found. Run Codex and sign in first.".to_string())?;
    let auth_json = fs::read_to_string(&auth_path)
        .map_err(|err| format!("Unable to read Codex auth file: {err}"))?;
    let auth: Value = serde_json::from_str(&auth_json)
        .map_err(|err| format!("Codex auth file is not valid JSON: {err}"))?;
    let access_token = auth
        .pointer("/tokens/access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Codex auth is missing an access token. Run codex login again.".to_string()
        })?;
    let account_id = auth
        .pointer("/tokens/account_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Codex auth is missing an account id. Run codex login again.".to_string())?;

    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("codex-cli")
        .build()
        .map_err(|err| format!("Unable to create Codex usage client: {err}"))?;
    let response = client
        .get(CODEX_USAGE_URL)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .header("ChatGPT-Account-Id", account_id)
        .header("Origin", "https://chatgpt.com")
        .header("Referer", "https://chatgpt.com/")
        .send()
        .map_err(|err| format!("Codex usage request failed: {err}"))?;

    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Ok(LocalUsageResponse {
            status: "unavailable".to_string(),
            source: "codex_local".to_string(),
            fetched_at,
            plan_type: None,
            message: Some("Codex auth was rejected. Open Codex or run codex login to refresh your local session.".to_string()),
            windows: vec![],
        });
    }

    if !response.status().is_success() {
        return Ok(LocalUsageResponse {
            status: "error".to_string(),
            source: "codex_local".to_string(),
            fetched_at,
            plan_type: None,
            message: Some(format!(
                "Codex usage endpoint returned HTTP {}.",
                response.status()
            )),
            windows: vec![],
        });
    }

    let payload: Value = response
        .json()
        .map_err(|err| format!("Codex usage response was not valid JSON: {err}"))?;
    let plan_type = payload
        .get("plan_type")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let windows = normalize_codex_usage_windows(&payload);

    Ok(LocalUsageResponse {
        status: if windows.is_empty() { "error" } else { "live" }.to_string(),
        source: "codex_local".to_string(),
        fetched_at,
        plan_type,
        message: if windows.is_empty() {
            Some("Codex usage response did not include 5h or weekly windows.".to_string())
        } else {
            None
        },
        windows,
    })
}

#[tauri::command]
fn sync_claude_code_usage() -> Result<LocalUsageResponse, String> {
    let fetched_at = unix_seconds_to_iso(current_unix_seconds());
    let Some(path) = local_usage_export_path("claude-code-usage.json") else {
        return Ok(local_unavailable_response(
            "claude_code_local",
            fetched_at,
            "Unable to locate the user profile for the Claude Code usage export.",
        ));
    };

    if !path.exists() {
        return Ok(local_unavailable_response(
            "claude_code_local",
            fetched_at,
            "Claude Code status-line export was not found. Run scripts/install-claude-statusline.ps1, then use Claude Code once.",
        ));
    }

    let payload = read_json_file(&path, "Claude Code usage export")?;
    let windows = normalize_claude_code_windows(&payload);

    Ok(LocalUsageResponse {
        status: if windows.is_empty() {
            "unavailable"
        } else {
            "live"
        }
        .to_string(),
        source: "claude_code_local".to_string(),
        fetched_at,
        plan_type: payload
            .get("plan_type")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        message: if windows.is_empty() {
            Some("Claude Code export did not include subscriber rate limits yet. Claude Code only exposes these after the first API response for Pro/Max users.".to_string())
        } else {
            None
        },
        windows,
    })
}

#[tauri::command]
fn sync_gemini_usage() -> Result<LocalUsageResponse, String> {
    let fetched_at = unix_seconds_to_iso(current_unix_seconds());
    let Some(path) = local_usage_export_path("gemini-cli-usage.json") else {
        return Ok(local_unavailable_response(
            "gemini_cli_local",
            fetched_at,
            "Unable to locate the user profile for the Gemini CLI usage export.",
        ));
    };

    if !path.exists() {
        return Ok(local_unavailable_response(
            "gemini_cli_local",
            fetched_at,
            "Gemini CLI quota export was not found. Use the local Gemini CLI helper when quota data is available, or keep Gemini manual.",
        ));
    }

    let payload = read_json_file(&path, "Gemini CLI usage export")?;
    let windows = normalize_gemini_windows(&payload);

    Ok(LocalUsageResponse {
        status: if windows.is_empty() {
            "unavailable"
        } else {
            "live"
        }
        .to_string(),
        source: "gemini_cli_local".to_string(),
        fetched_at,
        plan_type: payload
            .get("plan_type")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        message: if windows.is_empty() {
            Some(
                "Gemini CLI export did not include quota buckets that Ai Usage Dock can normalize."
                    .to_string(),
            )
        } else {
            None
        },
        windows,
    })
}

#[tauri::command]
fn show_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
fn set_open_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        let value_name = "Ai Usage Dock";
        if enabled {
            let exe = std::env::current_exe().map_err(|err| err.to_string())?;
            let exe_value = format!("\"{}\"", exe.display());
            let status = Command::new("reg")
                .args([
                    "add", run_key, "/v", value_name, "/t", "REG_SZ", "/d", &exe_value, "/f",
                ])
                .status()
                .map_err(|err| format!("Unable to update Windows startup setting: {err}"))?;
            if !status.success() {
                return Err("Windows rejected the startup registry update.".into());
            }
            return Ok(());
        }

        let _ = Command::new("reg")
            .args(["delete", run_key, "/v", value_name, "/f"])
            .status();
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
fn update_tray_state(
    app: tauri::AppHandle,
    percentage: Option<u32>,
    status: String,
    tooltip: String,
) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon is unavailable.".to_string())?;
    let prefix = match (percentage, status.as_str()) {
        (Some(value), "green") => format!("Green {:02}", value.min(99)),
        (Some(value), "yellow") => format!("Yellow {:02}", value.min(99)),
        (Some(value), "red") => format!("Red {:02}", value.min(99)),
        _ => "Neutral".to_string(),
    };
    let tooltip = format!("{prefix}\n{tooltip}");
    tray.set_tooltip(Some(&tooltip))
        .map_err(|err| format!("Unable to update tray tooltip: {err}"))?;
    tray.set_icon(Some(make_status_icon(&status, percentage)))
        .map_err(|err| format!("Unable to update tray icon: {err}"))?;
    Ok(())
}

fn find_codex_auth_path() -> Option<PathBuf> {
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let path = PathBuf::from(codex_home).join("auth.json");
        if path.exists() {
            return Some(path);
        }
    }

    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let path = PathBuf::from(home).join(".codex").join("auth.json");
    path.exists().then_some(path)
}

fn normalize_codex_usage_windows(payload: &Value) -> Vec<LocalUsageWindow> {
    let mut windows = Vec::new();
    if let Some(primary) = payload.pointer("/rate_limit/primary_window") {
        if let Some(window) = normalize_codex_usage_window("5h", primary) {
            windows.push(window);
        }
    }
    if let Some(secondary) = payload.pointer("/rate_limit/secondary_window") {
        if let Some(window) = normalize_codex_usage_window("weekly", secondary) {
            windows.push(window);
        }
    }
    windows
}

fn normalize_codex_usage_window(label: &str, payload: &Value) -> Option<LocalUsageWindow> {
    let used_percent = payload.get("used_percent")?.as_u64()?.min(100) as u32;
    let reset_at = payload
        .get("reset_at")
        .and_then(Value::as_u64)
        .map(unix_seconds_to_iso);
    let limit_window_seconds = payload.get("limit_window_seconds").and_then(Value::as_u64);

    Some(LocalUsageWindow {
        label: label.to_string(),
        used_percent,
        remaining_percent: 100u32.saturating_sub(used_percent),
        reset_at,
        limit_window_seconds,
    })
}

fn normalize_claude_code_windows(payload: &Value) -> Vec<LocalUsageWindow> {
    if let Some(windows) = normalize_export_windows(payload) {
        return windows;
    }

    let mut windows = Vec::new();
    if let Some(window) = payload
        .pointer("/rate_limits/five_hour")
        .and_then(|value| normalize_percent_window("5h", value, Some(18_000)))
    {
        windows.push(window);
    }
    if let Some(window) = payload
        .pointer("/rate_limits/seven_day")
        .and_then(|value| normalize_percent_window("weekly", value, Some(604_800)))
    {
        windows.push(window);
    }
    windows
}

fn normalize_gemini_windows(payload: &Value) -> Vec<LocalUsageWindow> {
    if let Some(windows) = normalize_export_windows(payload) {
        return windows;
    }

    let Some(buckets) = payload.get("buckets").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut total_remaining = 0.0;
    let mut total_limit = 0.0;
    let mut reset_at: Option<String> = None;

    for bucket in buckets {
        let fraction = bucket
            .get("remainingFraction")
            .or_else(|| bucket.get("remaining_fraction"))
            .and_then(number_from_value)
            .map(|value| value.clamp(0.0, 1.0));
        let remaining = bucket
            .get("remainingAmount")
            .or_else(|| bucket.get("remaining_amount"))
            .and_then(number_from_value);

        let (bucket_remaining, bucket_limit) = match (remaining, fraction) {
            (Some(remaining), Some(fraction)) if fraction > 0.0 => {
                (remaining.max(0.0), (remaining / fraction).max(remaining))
            }
            (_, Some(fraction)) => (fraction * 100.0, 100.0),
            (Some(remaining), None) => (remaining.max(0.0), remaining.max(0.0)),
            _ => continue,
        };

        total_remaining += bucket_remaining;
        total_limit += bucket_limit;

        if reset_at.is_none() {
            reset_at = bucket
                .get("resetTime")
                .or_else(|| bucket.get("reset_time"))
                .and_then(reset_value_to_iso);
        }
    }

    if total_limit <= 0.0 {
        return Vec::new();
    }

    let remaining_percent = ((total_remaining / total_limit) * 100.0)
        .round()
        .clamp(0.0, 100.0) as u32;
    vec![LocalUsageWindow {
        label: "daily".to_string(),
        used_percent: 100u32.saturating_sub(remaining_percent),
        remaining_percent,
        reset_at,
        limit_window_seconds: Some(86_400),
    }]
}

fn normalize_export_windows(payload: &Value) -> Option<Vec<LocalUsageWindow>> {
    let windows = payload.get("windows")?.as_array()?;
    let normalized: Vec<LocalUsageWindow> = windows
        .iter()
        .filter_map(|window| {
            let label = window.get("label")?.as_str()?;
            if !matches!(label, "5h" | "daily" | "weekly" | "monthly" | "custom") {
                return None;
            }

            let used_percent = window
                .get("used_percent")
                .or_else(|| window.get("usedPercentage"))
                .and_then(number_from_value)
                .map(clamp_percent)
                .or_else(|| {
                    window
                        .get("remaining_percent")
                        .or_else(|| window.get("remainingPercentage"))
                        .and_then(number_from_value)
                        .map(|value| 100u32.saturating_sub(clamp_percent(value)))
                })?;

            Some(LocalUsageWindow {
                label: label.to_string(),
                used_percent,
                remaining_percent: 100u32.saturating_sub(used_percent),
                reset_at: window
                    .get("reset_at")
                    .or_else(|| window.get("resetAt"))
                    .and_then(reset_value_to_iso),
                limit_window_seconds: window
                    .get("limit_window_seconds")
                    .or_else(|| window.get("limitWindowSeconds"))
                    .and_then(Value::as_u64),
            })
        })
        .collect();

    Some(normalized)
}

fn normalize_percent_window(
    label: &str,
    payload: &Value,
    limit_window_seconds: Option<u64>,
) -> Option<LocalUsageWindow> {
    let used_percent = payload
        .get("used_percentage")
        .or_else(|| payload.get("usedPercentage"))
        .and_then(number_from_value)
        .map(clamp_percent)?;

    Some(LocalUsageWindow {
        label: label.to_string(),
        used_percent,
        remaining_percent: 100u32.saturating_sub(used_percent),
        reset_at: payload
            .get("resets_at")
            .or_else(|| payload.get("resetsAt"))
            .or_else(|| payload.get("reset_at"))
            .or_else(|| payload.get("resetAt"))
            .and_then(reset_value_to_iso),
        limit_window_seconds,
    })
}

fn local_unavailable_response(
    source: &str,
    fetched_at: String,
    message: &str,
) -> LocalUsageResponse {
    LocalUsageResponse {
        status: "unavailable".to_string(),
        source: source.to_string(),
        fetched_at,
        plan_type: None,
        message: Some(message.to_string()),
        windows: Vec::new(),
    }
}

fn read_json_file(path: &PathBuf, label: &str) -> Result<Value, String> {
    let json = fs::read_to_string(path).map_err(|err| format!("Unable to read {label}: {err}"))?;
    serde_json::from_str(&json).map_err(|err| format!("{label} is not valid JSON: {err}"))
}

fn local_usage_export_path(file_name: &str) -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(PathBuf::from(home).join(".ai-usage-dock").join(file_name))
}

fn number_from_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
}

fn clamp_percent(value: f64) -> u32 {
    value.round().clamp(0.0, 100.0) as u32
}

fn reset_value_to_iso(value: &Value) -> Option<String> {
    if let Some(seconds) = value.as_u64() {
        return Some(unix_seconds_to_iso(seconds));
    }
    value
        .as_str()
        .filter(|item| !item.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn current_unix_seconds() -> u64 {
    UNIX_EPOCH
        .elapsed()
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn unix_seconds_to_iso(seconds: u64) -> String {
    let datetime = UNIX_EPOCH + Duration::from_secs(seconds);
    let duration = datetime
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    format_unix_seconds_as_iso(duration.as_secs())
}

fn format_unix_seconds_as_iso(seconds: u64) -> String {
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m as u32, d as u32)
}

fn make_status_icon(status: &str, percentage: Option<u32>) -> Image<'static> {
    let color = match status {
        "green" => [31, 157, 99, 255],
        "yellow" => [183, 121, 31, 255],
        "red" => [194, 65, 59, 255],
        _ => [102, 112, 128, 255],
    };
    let size = 32usize;
    let mut rgba = vec![0u8; size * size * 4];

    for y in 0..size {
        for x in 0..size {
            let index = (y * size + x) * 4;
            rgba[index..index + 4].copy_from_slice(&color);
        }
    }

    if let Some(value) = percentage {
        draw_percentage(&mut rgba, size, value.min(99));
    }

    Image::new_owned(rgba, size as u32, size as u32)
}

fn draw_percentage(rgba: &mut [u8], size: usize, value: u32) {
    let text = format!("{:02}", value);
    let digits: Vec<u32> = text.chars().filter_map(|item| item.to_digit(10)).collect();
    for (index, digit) in digits.iter().enumerate() {
        draw_digit(rgba, size, *digit, 5 + index * 12, 7);
    }
}

fn draw_digit(rgba: &mut [u8], size: usize, digit: u32, x: usize, y: usize) {
    let segments = match digit {
        0 => [true, true, true, true, true, true, false],
        1 => [false, true, true, false, false, false, false],
        2 => [true, true, false, true, true, false, true],
        3 => [true, true, true, true, false, false, true],
        4 => [false, true, true, false, false, true, true],
        5 => [true, false, true, true, false, true, true],
        6 => [true, false, true, true, true, true, true],
        7 => [true, true, true, false, false, false, false],
        8 => [true, true, true, true, true, true, true],
        _ => [true, true, true, true, false, true, true],
    };
    if segments[0] {
        draw_rect(rgba, size, x + 2, y, 7, 2);
    }
    if segments[1] {
        draw_rect(rgba, size, x + 8, y + 2, 2, 6);
    }
    if segments[2] {
        draw_rect(rgba, size, x + 8, y + 10, 2, 6);
    }
    if segments[3] {
        draw_rect(rgba, size, x + 2, y + 16, 7, 2);
    }
    if segments[4] {
        draw_rect(rgba, size, x, y + 10, 2, 6);
    }
    if segments[5] {
        draw_rect(rgba, size, x, y + 2, 2, 6);
    }
    if segments[6] {
        draw_rect(rgba, size, x + 2, y + 8, 7, 2);
    }
}

fn draw_rect(rgba: &mut [u8], size: usize, x: usize, y: usize, width: usize, height: usize) {
    for yy in y..(y + height) {
        for xx in x..(x + width) {
            if xx >= size || yy >= size {
                continue;
            }
            let index = (yy * size + xx) * 4;
            rgba[index..index + 4].copy_from_slice(&[255, 255, 255, 255]);
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_tray_action(app: &tauri::AppHandle, action: &str) {
    show_main_window(app);
    let _ = app.emit("tray-action", action);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            has_api_key,
            remove_api_key,
            sync_codex_usage,
            sync_claude_code_usage,
            sync_gemini_usage,
            show_dashboard,
            set_open_at_login,
            update_tray_state
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open dashboard", true, None::<&str>)?;
            let reset = MenuItem::with_id(
                app,
                "reset-current-period",
                "Reset Current Period",
                true,
                None::<&str>,
            )?;
            let add_usage =
                MenuItem::with_id(app, "add-usage", "Add manual usage", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &add_usage, &reset, &settings, &quit])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("Ai Usage Dock\nNo token limit configured.")
                .icon(make_status_icon("neutral", None))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "add-usage" => emit_tray_action(app, "add-usage"),
                    "reset-current-period" => emit_tray_action(app, "reset-current-period"),
                    "settings" => emit_tray_action(app, "settings"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            show_main_window(tray.app_handle());
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Ai Usage Dock");
}
