//! ForgeRoutine Agent.
//!
//! A small helper that lets ForgeRoutine use the Claude Code and Codex already
//! installed and signed in on this computer. It is not ForgeRoutine itself —
//! that stays in the browser. While this runs, the server sends AI work here
//! first; when it is closed, the server falls back to the user's saved keys.
//!
//! Closing the window keeps it running in the tray; Quit in the tray stops it.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod connection;
mod state;
mod tools;

use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

use state::{AgentConfig, PublicState, Shared, DEFAULT_SERVER};

#[tauri::command]
fn get_state(shared: State<'_, Arc<Shared>>) -> PublicState {
    shared.view()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paired {
    token: String,
    device_id: String,
    name: String,
    email: String,
}

/// Trades the code from Settings for this agent's own token.
#[tauri::command]
async fn pair(
    shared: State<'_, Arc<Shared>>,
    code: String,
    server: Option<String>,
) -> Result<PublicState, String> {
    let server = server
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SERVER.to_string());

    let response = reqwest::Client::new()
        .post(format!("{server}/api/v1/agent/pair"))
        .timeout(Duration::from_secs(20))
        .json(&serde_json::json!({ "code": code.trim(), "name": device_name() }))
        .send()
        .await
        .map_err(|e| format!("Could not reach ForgeRoutine at {server} ({e})."))?;

    if !response.status().is_success() {
        // The API answers with problem details; `detail` is the sentence.
        let body: serde_json::Value = response.json().await.unwrap_or_default();
        return Err(body["detail"]
            .as_str()
            .unwrap_or("Pairing failed. Create a new code in Settings → AI and try again.")
            .to_string());
    }

    let paired: Paired = response
        .json()
        .await
        .map_err(|e| format!("Unexpected reply from ForgeRoutine ({e})."))?;

    shared.save_config(AgentConfig {
        server,
        token: paired.token,
        device_id: paired.device_id,
        device_name: paired.name,
        email: paired.email,
    })?;

    Ok(shared.view())
}

/// Forgets the pairing here. Settings still lists the device until it is
/// disconnected there too, which is what invalidates the token.
#[tauri::command]
fn unpair(shared: State<'_, Arc<Shared>>) -> PublicState {
    shared.forget_config();
    shared.set_status("unpaired", None);
    shared.view()
}

/// Searches for the CLIs again and tells the server what was found.
#[tauri::command]
async fn recheck(shared: State<'_, Arc<Shared>>) -> Result<PublicState, String> {
    if shared.status().0 == "connected" {
        shared.recheck.notify_one();
    } else {
        shared.set_tools(tools::detect().await);
    }
    Ok(shared.view())
}

/// How Settings lists this machine.
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map(|name| name.trim().to_string())
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "This computer".into())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        // A second copy would fight the first for the same connection; bring
        // the running one forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("agent.json");
            let shared = Arc::new(Shared::new(app.handle().clone(), config_path));
            app.manage(shared.clone());

            tauri::async_runtime::spawn(connection::run_forever(shared));

            let show = MenuItem::with_id(app, "show", "Show ForgeRoutine Agent", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("an app icon"))
                .tooltip("ForgeRoutine Agent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window is not quitting: the agent is only useful
            // while it runs. Quit lives in the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![get_state, pair, unpair, recheck])
        .run(tauri::generate_context!())
        .expect("ForgeRoutine Agent failed to start");
}
