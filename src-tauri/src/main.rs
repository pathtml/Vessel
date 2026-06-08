use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};

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
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open dashboard", true, None::<&str>)?;
            let add_usage = MenuItem::with_id(app, "add-usage", "Add usage", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset-first-provider", "Reset first provider", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &add_usage, &reset, &settings, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .tooltip("LLM Usage Tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "add-usage" => emit_tray_action(app, "add-usage"),
                    "reset-first-provider" => emit_tray_action(app, "reset-first-provider"),
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
        .expect("error while running LLM Usage Tray");
}
