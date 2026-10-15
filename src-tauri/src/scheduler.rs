use crate::alerts::{self, AlertState};
use crate::model::{now, Health, UsageSnapshot};
use crate::providers::AnyProvider;
use crate::settings::Settings;
use crate::store::Store;
use crate::tray;
use std::path::PathBuf;
use std::sync::atomic::AtomicI64;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

pub const TRAY_ID: &str = "vessel-tray";
/// How often the loop wakes to check whether a refresh is due.
const TICK: Duration = Duration::from_secs(30);

pub struct AppState {
    pub store: Mutex<Store>,
    pub settings: Mutex<Settings>,
    pub settings_path: Option<PathBuf>,
    pub alerts: Mutex<AlertState>,
    pub refresh: Arc<Notify>,
    /// Unix millis when the popup last hid itself (focus lost).
    pub last_hidden_ms: AtomicI64,
}

/// Normal cadence is the user's chosen interval. While something is offline, retry sooner but
/// back off, with a little jitter so retries never line up.
pub fn next_delay(consecutive_offline: u32, jitter_secs: u64, base_secs: u64) -> Duration {
    let base = if consecutive_offline == 0 {
        base_secs
    } else {
        (60u64 << (consecutive_offline - 1).min(4)).min(900)
    };
    Duration::from_secs(base + jitter_secs % 15)
}

/// The loop ticks every 30s. If much more wall-clock time passed than that, the PC was asleep.
pub fn woke_from_sleep(prev_ms: i64, now_ms: i64) -> bool {
    now_ms - prev_ms > (TICK.as_millis() as i64) * 3
}

pub async fn refresh_all(app: &AppHandle) -> bool {
    let mut any_offline = false;
    for provider in AnyProvider::all() {
        // Nothing is read or fetched for a provider until the user has accepted the
        // notice and connected it.
        let allowed = {
            let settings = app.state::<AppState>().settings.lock().unwrap().clone();
            !provider.needs_connect()
                || (settings.consent_accepted && settings.is_connected(provider.id()))
        };
        let snapshot = if allowed {
            provider.fetch().await
        } else {
            provider.not_connected()
        };
        any_offline |= snapshot.health == Health::Offline;
        let state = app.state::<AppState>();
        state.store.lock().unwrap().apply(snapshot);
    }
    let snapshots = {
        let state = app.state::<AppState>();
        let store = state.store.lock().unwrap();
        store.save();
        store.all()
    };
    update_tray(app, &snapshots);
    send_alerts(app, &snapshots);
    let _ = app.emit("usage_updated", &snapshots);
    any_offline
}

/// Warnings are always tracked (so they are not repeated later) but only shown when alerts
/// are on and it is not quiet hours.
fn send_alerts(app: &AppHandle, snapshots: &[UsageSnapshot]) {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    if !settings.consent_accepted || !settings.onboarding_done {
        return;
    }
    let pending = {
        let mut alert_state = state.alerts.lock().unwrap();
        let pending = alert_state.evaluate(snapshots, settings.low_threshold);
        alert_state.save();
        pending
    };
    let quiet = alerts::in_quiet_hours(
        alerts::local_hour(),
        settings.quiet_start,
        settings.quiet_end,
    );
    if !settings.alerts_enabled || quiet {
        return;
    }
    for alert in pending {
        let _ = app
            .notification()
            .builder()
            .title(alert.title)
            .body(alert.body)
            .show();
    }
}

pub fn update_tray(app: &AppHandle, snapshots: &[UsageSnapshot]) {
    if let Some(tray_icon) = app.tray_by_id(TRAY_ID) {
        let _ = tray_icon.set_icon(Some(tray::render_icon(
            tray::level(snapshots),
            tray::has_warning(snapshots),
        )));
        let _ = tray_icon.set_tooltip(Some(tray::tooltip(snapshots)));
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut offline_streak = 0u32;
        loop {
            let any_offline = refresh_all(&app).await;
            offline_streak = if any_offline { offline_streak + 1 } else { 0 };

            let base_secs = app
                .state::<AppState>()
                .settings
                .lock()
                .unwrap()
                .refresh_minutes as u64
                * 60;
            let wait = next_delay(offline_streak, now() as u64, base_secs);
            let notify = app.state::<AppState>().refresh.clone();

            // Wait until the next refresh is due, a manual refresh is requested, or the PC wakes.
            let mut waited = Duration::ZERO;
            let mut last_tick_ms = now() * 1000;
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(TICK) => {}
                    _ = notify.notified() => break,
                }
                let now_ms = now() * 1000;
                let woke = woke_from_sleep(last_tick_ms, now_ms);
                last_tick_ms = now_ms;
                waited += TICK;
                if woke || waited >= wait {
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_cadence_follows_the_setting() {
        assert_eq!(next_delay(0, 0, 300), Duration::from_secs(300));
        assert_eq!(next_delay(0, 0, 60), Duration::from_secs(60));
        assert_eq!(next_delay(0, 0, 1800), Duration::from_secs(1800));
    }

    #[test]
    fn backs_off_and_caps() {
        assert_eq!(next_delay(1, 0, 300), Duration::from_secs(60));
        assert_eq!(next_delay(2, 0, 300), Duration::from_secs(120));
        assert_eq!(next_delay(10, 0, 300), Duration::from_secs(900));
    }

    #[test]
    fn jitter_is_bounded() {
        assert!(next_delay(0, 9999, 300) < Duration::from_secs(315));
    }

    #[test]
    fn detects_sleep_from_a_wall_clock_jump() {
        assert!(!woke_from_sleep(0, 31_000));
        assert!(!woke_from_sleep(0, 90_000));
        assert!(woke_from_sleep(0, 600_000));
    }
}
