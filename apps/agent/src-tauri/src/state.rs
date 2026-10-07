//! What the agent knows — its pairing, its status, the tools it found — and
//! the window's view of it.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::tools::Tools;

/// The deployed ForgeRoutine API this agent connects to.
pub const DEFAULT_SERVER: &str = "http://187.127.179.114:50005";

/// The pairing, saved in the app's own config folder. The token is the only
/// secret, and it can do nothing but open this agent's connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub server: String,
    pub token: String,
    pub device_id: String,
    pub device_name: String,
    pub email: String,
}

/// What the window shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicState {
    /// unpaired | connecting | connected | disconnected | revoked
    pub status: String,
    pub detail: Option<String>,
    pub server: String,
    pub email: Option<String>,
    pub device_name: Option<String>,
    pub tools: Option<Tools>,
}

pub struct Shared {
    app: AppHandle,
    config_path: PathBuf,
    config: Mutex<Option<AgentConfig>>,
    status: Mutex<(String, Option<String>)>,
    tools: Mutex<Option<Tools>>,
    /// The pairing changed: drop the connection and start again.
    pub wake: Notify,
    /// "Check again": search for the CLIs and tell the server.
    pub recheck: Notify,
}

impl Shared {
    pub fn new(app: AppHandle, config_path: PathBuf) -> Self {
        let config = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());

        Self {
            app,
            config_path,
            config: Mutex::new(config),
            status: Mutex::new(("unpaired".into(), None)),
            tools: Mutex::new(None),
            wake: Notify::new(),
            recheck: Notify::new(),
        }
    }

    pub fn config(&self) -> Option<AgentConfig> {
        self.config.lock().unwrap().clone()
    }

    pub fn save_config(&self, config: AgentConfig) -> Result<(), String> {
        if let Some(dir) = self.config_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Could not save the pairing: {e}"))?;
        }
        let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        std::fs::write(&self.config_path, text).map_err(|e| format!("Could not save the pairing: {e}"))?;
        *self.config.lock().unwrap() = Some(config);
        self.wake.notify_one();
        Ok(())
    }

    pub fn forget_config(&self) {
        let _ = std::fs::remove_file(&self.config_path);
        *self.config.lock().unwrap() = None;
        *self.tools.lock().unwrap() = None;
        self.wake.notify_one();
    }

    pub fn status(&self) -> (String, Option<String>) {
        self.status.lock().unwrap().clone()
    }

    pub fn set_status(&self, status: &str, detail: Option<String>) {
        // Debug builds only: the release build has no console to print to.
        #[cfg(debug_assertions)]
        eprintln!("[agent] {status}{}", detail.as_deref().map(|d| format!(": {d}")).unwrap_or_default());
        *self.status.lock().unwrap() = (status.to_string(), detail);
        self.publish();
    }

    pub fn set_tools(&self, tools: Tools) {
        *self.tools.lock().unwrap() = Some(tools);
        self.publish();
    }

    pub fn view(&self) -> PublicState {
        let (status, detail) = self.status();
        let config = self.config();
        PublicState {
            status,
            detail,
            server: config.as_ref().map(|c| c.server.clone()).unwrap_or_else(|| DEFAULT_SERVER.into()),
            email: config.as_ref().map(|c| c.email.clone()),
            device_name: config.as_ref().map(|c| c.device_name.clone()),
            tools: self.tools.lock().unwrap().clone(),
        }
    }

    /// Tells the window; it redraws from this alone.
    fn publish(&self) {
        let _ = self.app.emit("agent-state", self.view());
    }
}
