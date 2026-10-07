//! The one connection to ForgeRoutine, kept open for as long as the agent runs.
//!
//! The agent dials out — the server cannot reach into this machine — and
//! then waits for jobs. It says which CLIs it found, runs each job it is
//! sent, and sends back what the CLI printed. When the connection drops it
//! reconnects with backoff; when the server says the pairing was revoked it
//! forgets its token and stops.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::{
    self, client::IntoClientRequest, http::header::AUTHORIZATION, Message,
};

use crate::state::{AgentConfig, Shared};
use crate::tools::{self, CliJob};

/// Sent by the server when the device was disconnected in Settings.
const CLOSE_REVOKED: u16 = 4401;

enum Ended {
    /// The pairing is gone: forget the token, stop until paired again.
    Revoked(String),
    /// Lost or refused for a reason that may pass: try again later.
    Lost { reason: String, was_connected: bool },
    /// Paired, unpaired or re-paired from the window: start over at once.
    Restart,
}

pub async fn run_forever(shared: Arc<Shared>) {
    let mut backoff = Duration::from_secs(1);

    loop {
        let Some(config) = shared.config() else {
            // Not paired. Leave a "revoked" message on screen until the user
            // acts; otherwise say there is nothing to connect yet.
            if shared.status().0 != "revoked" {
                shared.set_status("unpaired", None);
            }
            shared.wake.notified().await;
            continue;
        };

        shared.set_status("connecting", None);

        match session(&shared, &config).await {
            Ended::Restart => continue,
            Ended::Revoked(reason) => {
                shared.forget_config();
                shared.set_status("revoked", Some(reason));
            }
            Ended::Lost { reason, was_connected } => {
                if was_connected {
                    backoff = Duration::from_secs(1);
                }
                shared.set_status(
                    "disconnected",
                    Some(format!("{reason} Retrying in {}s.", backoff.as_secs())),
                );
                // A pairing change interrupts the wait.
                tokio::select! {
                    _ = tokio::time::sleep(backoff) => {}
                    _ = shared.wake.notified() => {}
                }
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

/// `http://host:port` → `ws://host:port/api/v1/agent/connect`.
pub fn socket_url(server: &str) -> String {
    let base = server.trim().trim_end_matches('/');
    let base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{base}")
    };
    format!("{base}/api/v1/agent/connect")
}

async fn session(shared: &Arc<Shared>, config: &AgentConfig) -> Ended {
    let lost = |reason: String, was_connected: bool| Ended::Lost { reason, was_connected };

    let mut request = match socket_url(&config.server).into_client_request() {
        Ok(request) => request,
        Err(e) => return lost(format!("The server address is not valid ({e})."), false),
    };
    match format!("Bearer {}", config.token).parse() {
        Ok(value) => {
            request.headers_mut().insert(AUTHORIZATION, value);
        }
        Err(_) => return Ended::Revoked("The saved token is damaged. Pair again.".into()),
    }

    let socket = tokio::select! {
        result = tokio_tungstenite::connect_async(request) => result,
        _ = shared.wake.notified() => return Ended::Restart,
    };
    let (socket, _) = match socket {
        Ok(connected) => connected,
        Err(tungstenite::Error::Http(response)) if response.status() == 401 => {
            return Ended::Revoked(
                "ForgeRoutine no longer recognises this agent. Pair it again with a new code from Settings → AI.".into(),
            )
        }
        Err(e) => return lost(format!("Could not reach {} ({e}).", config.server), false),
    };

    let (mut sink, mut stream) = socket.split();

    // Results from running jobs, sent back by this one writer.
    let (outbox, mut outgoing) = mpsc::unbounded_channel::<String>();
    let running: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>> = Arc::default();

    let tools = tools::detect().await;
    shared.set_tools(tools.clone());
    let hello = json!({ "type": "hello", "version": env!("CARGO_PKG_VERSION"), "tools": tools });
    if let Err(e) = sink.send(Message::text(hello.to_string())).await {
        return lost(format!("The connection closed straight away ({e})."), false);
    }
    shared.set_status("connected", None);

    let ended = loop {
        tokio::select! {
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    handle(text.as_str(), &outbox, &running);
                }
                Some(Ok(Message::Ping(data))) => {
                    let _ = sink.send(Message::Pong(data)).await;
                }
                Some(Ok(Message::Close(frame))) => {
                    let code = frame.as_ref().map(|f| u16::from(f.code));
                    break if code == Some(CLOSE_REVOKED) {
                        Ended::Revoked("This agent was disconnected in Settings. Pair it again with a new code to reconnect.".into())
                    } else {
                        let why = frame.map(|f| f.reason.to_string()).filter(|r| !r.is_empty());
                        lost(format!("ForgeRoutine closed the connection{}.", why.map(|r| format!(" ({r})")).unwrap_or_default()), true)
                    };
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => break lost(format!("The connection dropped ({e})."), true),
                None => break lost("The connection dropped.".into(), true),
            },
            Some(message) = outgoing.recv() => {
                if let Err(e) = sink.send(Message::text(message)).await {
                    break lost(format!("Could not send a result ({e})."), true);
                }
            }
            _ = shared.recheck.notified() => {
                let tools = tools::detect().await;
                shared.set_tools(tools.clone());
                let update = json!({ "type": "tools", "tools": tools });
                let _ = sink.send(Message::text(update.to_string())).await;
            }
            _ = shared.wake.notified() => {
                let _ = sink.close().await;
                break Ended::Restart;
            }
        }
    };

    // Anything still running has nobody to report to.
    for (_, cancel) in running.lock().unwrap().drain() {
        let _ = cancel.send(());
    }
    ended
}

/// One message from the server: a job to run, or one to stop.
fn handle(
    text: &str,
    outbox: &mpsc::UnboundedSender<String>,
    running: &Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
) {
    let Ok(message) = serde_json::from_str::<Value>(text) else { return };
    let id = message["id"].as_str().unwrap_or_default().to_string();

    match message["type"].as_str() {
        Some("run") => {
            let job: CliJob = match serde_json::from_value(message["job"].clone()) {
                Ok(job) => job,
                Err(e) => {
                    let _ = outbox.send(json!({ "type": "failed", "id": id, "error": format!("Unreadable job: {e}") }).to_string());
                    return;
                }
            };

            let (cancel, cancelled) = oneshot::channel();
            running.lock().unwrap().insert(id.clone(), cancel);
            let outbox = outbox.clone();
            let running = running.clone();

            tokio::spawn(async move {
                let reply = match tools::run(job, cancelled).await {
                    Ok(outcome) => json!({ "type": "result", "id": id, "outcome": outcome }),
                    Err(error) => json!({ "type": "failed", "id": id, "error": error }),
                };
                running.lock().unwrap().remove(&id);
                let _ = outbox.send(reply.to_string());
            });
        }
        Some("cancel") => {
            if let Some(cancel) = running.lock().unwrap().remove(&id) {
                let _ = cancel.send(());
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::socket_url;

    #[test]
    fn builds_the_socket_address_from_the_server() {
        assert_eq!(socket_url("http://187.127.179.114:50005"), "ws://187.127.179.114:50005/api/v1/agent/connect");
        assert_eq!(socket_url("https://forge.example.com/"), "wss://forge.example.com/api/v1/agent/connect");
        assert_eq!(socket_url("localhost:50005"), "ws://localhost:50005/api/v1/agent/connect");
    }
}
