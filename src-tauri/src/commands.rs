use crate::claude_setup::{self, ConnectResult, ConnectStatus};
use crate::providers::codex::{self, LoginStatus};
use crate::scheduler::AppState;
use crate::settings::Settings;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DetectState {
    Ready,
    NeedsSignIn,
    NotInstalled,
    Connected,
    ComingSoon,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: String,
    pub display_name: String,
    pub state: DetectState,
    pub hint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateDto {
    pub settings: Settings,
    pub providers: Vec<ProviderStatus>,
    pub v1_found: bool,
}

fn status(id: &str, name: &str, state: DetectState, hint: &str) -> ProviderStatus {
    ProviderStatus {
        id: id.into(),
        display_name: name.into(),
        state,
        hint: hint.into(),
    }
}

/// What the onboarding screen shows for each provider.
pub fn detect(settings: &Settings) -> Vec<ProviderStatus> {
    let codex = if settings.is_connected("codex") {
        status("codex", "Codex", DetectState::Connected, "Connected.")
    } else {
        match codex::login_status() {
            LoginStatus::Ready => {
                status("codex", "Codex", DetectState::Ready, "Codex login found.")
            }
            _ => status(
                "codex",
                "Codex",
                DetectState::NeedsSignIn,
                "Sign in to Codex first (run `codex login`), then scan again.",
            ),
        }
    };
    let claude = if settings.is_connected("claude") {
        status("claude", "Claude", DetectState::Connected, "Connected.")
    } else if claude_setup::claude_installed() {
        status("claude", "Claude", DetectState::Ready, "Claude Code found.")
    } else {
        status(
            "claude",
            "Claude",
            DetectState::NotInstalled,
            "Install Claude Code and use it once, then scan again.",
        )
    };
    vec![
        codex,
        claude,
        status(
            "gemini",
            "Gemini",
            DetectState::ComingSoon,
            "Gemini app usage cannot be read automatically yet.",
        ),
    ]
}

fn persist(state: &AppState, change: impl FnOnce(&mut Settings)) {
    let mut settings = state.settings.lock().unwrap();
    change(&mut settings);
    settings.save(state.settings_path.as_ref());
}

#[tauri::command]
pub fn get_app_state(state: State<AppState>) -> AppStateDto {
    let settings = state.settings.lock().unwrap().clone();
    let providers = detect(&settings);
    AppStateDto {
        settings,
        providers,
        v1_found: claude_setup::v1_found(),
    }
}

#[tauri::command]
pub fn accept_consent(state: State<AppState>) {
    persist(&state, |s| s.consent_accepted = true);
}

#[tauri::command]
pub fn connect_provider(app: AppHandle, id: String, force: bool) -> ConnectResult {
    let state = app.state::<AppState>();
    if !state.settings.lock().unwrap().consent_accepted {
        return ConnectResult::new(ConnectStatus::Error, "Please accept the notice first.");
    }
    let result = match id.as_str() {
        "codex" => match codex::login_status() {
            LoginStatus::Ready => ConnectResult::new(ConnectStatus::Connected, "Connected."),
            _ => ConnectResult::new(
                ConnectStatus::NeedsSignIn,
                "Codex login not found. Sign in to Codex (run `codex login`), then try again.",
            ),
        },
        "claude" => claude_setup::install(force),
        _ => ConnectResult::new(
            ConnectStatus::Error,
            "This provider cannot be connected yet.",
        ),
    };
    if result.ok {
        persist(&state, |s| s.set_connected(&id, true));
        state.refresh.notify_one();
    }
    result
}

#[tauri::command]
pub fn disconnect_provider(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    if id == "claude" {
        claude_setup::uninstall()?;
    }
    persist(&state, |s| s.set_connected(&id, false));
    state.refresh.notify_one();
    Ok(())
}

#[tauri::command]
pub fn complete_onboarding(state: State<AppState>, open_at_login: bool) -> Result<(), String> {
    set_open_at_login(open_at_login)?;
    persist(&state, |s| {
        s.onboarding_done = true;
        s.open_at_login = open_at_login;
    });
    Ok(())
}

/// Saves what the settings screen is allowed to change. Consent and connections are untouched.
#[tauri::command]
pub fn save_settings(state: State<AppState>, edits: Settings) -> Result<Settings, String> {
    let wants_login = edits.open_at_login;
    let changed_login = state.settings.lock().unwrap().open_at_login != wants_login;
    if changed_login {
        set_open_at_login(wants_login)?;
    }
    persist(&state, |s| s.apply_user_edits(&edits));
    // A new refresh interval takes effect right away.
    state.refresh.notify_one();
    let saved = state.settings.lock().unwrap().clone();
    Ok(saved)
}

/// Async on purpose: creating a window from a sync command can deadlock on Windows.
#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?view=settings".into()),
    )
    .title("Vessel settings")
    .inner_size(440.0, 600.0)
    .min_inner_size(380.0, 420.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| format!("Could not open settings: {e}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_open_at_login(enabled: bool) -> Result<(), String> {
    use std::process::Command;
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let status = Command::new("reg")
            .args([
                "add",
                key,
                "/v",
                "Vessel",
                "/t",
                "REG_SZ",
                "/d",
                &format!("\"{}\"", exe.display()),
                "/f",
            ])
            .status()
            .map_err(|e| format!("Could not set start with Windows: {e}"))?;
        if !status.success() {
            return Err("Windows refused the start-with-Windows setting.".into());
        }
    } else {
        let _ = Command::new("reg")
            .args(["delete", key, "/v", "Vessel", "/f"])
            .status();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_open_at_login(_enabled: bool) -> Result<(), String> {
    Ok(())
}
