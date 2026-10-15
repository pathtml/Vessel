#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod alerts;
mod claude_setup;
mod commands;
mod model;
mod platform;
mod providers;
mod scheduler;
mod settings;
mod store;
mod tray;

use model::UsageSnapshot;
use scheduler::{AppState, TRAY_ID};
use settings::Settings;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, Rect, State, WindowEvent};
use tokio::sync::Notify;

/// Gap between the popup and the taskbar, in physical pixels.
const EDGE_GAP: f64 = 8.0;
/// A click on the tray icon right after the popup lost focus is the same click that closed it.
const REOPEN_GUARD_MS: i64 = 300;

#[tauri::command]
fn get_snapshots(state: State<AppState>) -> Vec<UsageSnapshot> {
    state.store.lock().unwrap().all()
}

#[tauri::command]
fn refresh(state: State<AppState>) {
    state.refresh.notify_one();
}

fn now_ms() -> i64 {
    model::now() * 1000
}

/// Opens the popup next to the tray icon (above a bottom taskbar, below a top one).
fn show_popup(app: &AppHandle, anchor: Option<Rect>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match (anchor, window.outer_size()) {
        (Some(rect), Ok(size)) => {
            let scale = window.scale_factor().unwrap_or(1.0);
            let pos = rect.position.to_physical::<f64>(scale);
            let icon = rect.size.to_physical::<f64>(scale);
            let (w, h) = (size.width as f64, size.height as f64);
            let mut x = pos.x + icon.width / 2.0 - w / 2.0;
            let mut y = pos.y - h - EDGE_GAP;
            if y < 0.0 {
                y = pos.y + icon.height + EDGE_GAP;
            }
            if let Ok(Some(monitor)) = app.monitor_from_point(pos.x, pos.y) {
                let (mx, mw) = (monitor.position().x as f64, monitor.size().width as f64);
                let max_x = (mx + mw - w - EDGE_GAP).max(mx + EDGE_GAP);
                x = x.clamp(mx + EDGE_GAP, max_x);
            }
            let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
        }
        _ => {
            let _ = window.center();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_popup(app: &AppHandle, anchor: Option<Rect>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let hidden_at = app
        .state::<AppState>()
        .last_hidden_ms
        .load(Ordering::Relaxed);
    if now_ms() - hidden_at < REOPEN_GUARD_MS {
        return;
    }
    show_popup(app, anchor);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_snapshots,
            refresh,
            commands::get_app_state,
            commands::accept_consent,
            commands::connect_provider,
            commands::disconnect_provider,
            commands::complete_onboarding,
            commands::save_settings,
            commands::open_settings,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir().ok();
            let store = store::Store::load(data_dir.as_ref().map(|d| d.join("snapshots.json")));
            let alert_state =
                alerts::AlertState::load(data_dir.as_ref().map(|d| d.join("alerts.json")));
            let settings_path = data_dir.map(|d| d.join("settings.json"));
            let settings = Settings::load(settings_path.as_deref());
            let first_run = !settings.onboarding_done;
            let cached = store.all();
            app.manage(AppState {
                store: Mutex::new(store),
                settings: Mutex::new(settings),
                settings_path,
                alerts: Mutex::new(alert_state),
                refresh: Arc::new(Notify::new()),
                last_hidden_ms: AtomicI64::new(0),
            });

            let open = MenuItem::with_id(app, "open", "Open Vessel", true, None::<&str>)?;
            let refresh_now = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &refresh_now, &settings_item, &quit])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray::render_icon(
                    tray::level(&cached),
                    tray::has_warning(&cached),
                ))
                .tooltip(tray::tooltip(&cached))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_popup(app, None),
                    "refresh" => app.state::<AppState>().refresh.notify_one(),
                    "settings" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::open_settings(app).await;
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        toggle_popup(tray.app_handle(), Some(rect));
                    }
                })
                .build(app)?;

            scheduler::start(app.handle().clone());
            if first_run {
                show_popup(app.handle(), None);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Popup behaviour applies to the main window only; Settings is a normal window.
            if window.label() != "main" {
                return;
            }
            match event {
                // The popup closes when it loses focus; Vessel keeps running in the tray.
                // During first-run onboarding it stays open so the user can switch to a terminal.
                WindowEvent::Focused(false) => {
                    let state = window.app_handle().state::<AppState>();
                    if !state.settings.lock().unwrap().onboarding_done {
                        return;
                    }
                    let _ = window.hide();
                    state.last_hidden_ms.store(now_ms(), Ordering::Relaxed);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Vessel");
}
