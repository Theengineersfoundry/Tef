use async_trait::async_trait;
use russh::client::{Handle, Handler, Msg};
use russh::ChannelMsg;
use russh::{Channel, ChannelId, Disconnect};
use russh_keys::key;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::state::{AppState, SessionEntry, SessionEvent, SshCmd};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub password: Option<String>,
  pub private_key_path: Option<String>,
}

struct ClientHandler {
  app: AppHandle,
  session_id: String,
}

#[async_trait]
impl Handler for ClientHandler {
  type Error = russh::Error;

  async fn check_server_key(
    &mut self,
    _server_public_key: &key::PublicKey,
  ) -> Result<bool, Self::Error> {
    Ok(true)
  }

  async fn channel_close(
    &mut self,
    _channel: ChannelId,
    _session: &mut russh::client::Session,
  ) -> Result<(), Self::Error> {
    let _ = self.app.emit(
      "session-event",
      SessionEvent {
        session_id: self.session_id.clone(),
        event_type: "DISCONNECTED".into(),
        data: None,
        message: Some("SSH channel closed".into()),
        error: None,
        baud_rate: None,
      },
    );
    Ok(())
  }
}

fn expand_key_path(raw: &str) -> PathBuf {
  let mut p = raw.to_string();
  if let Ok(profile) = std::env::var("USERPROFILE") {
    p = p.replace("$env:USERPROFILE", &profile);
    p = p.replace("%USERPROFILE%", &profile);
  }
  if let Some(home) = dirs::home_dir() {
    if let Some(stripped) = p.strip_prefix("~/") {
      return home.join(stripped);
    }
  }
  PathBuf::from(p)
}

pub async fn open_ssh(
  app: AppHandle,
  state: &AppState,
  session_id: String,
  config: SshConfig,
) -> Result<(), String> {
  crate::serial::close_if_exists(state, &session_id);

  let _ = app.emit(
    "session-event",
    SessionEvent {
      session_id: session_id.clone(),
      event_type: "STATUS".into(),
      data: None,
      message: Some(format!(
        "Connecting to {}@{}:{}…",
        config.username,
        config.host,
        config.port.unwrap_or(22)
      )),
      error: None,
      baud_rate: None,
    },
  );

  let port = config.port.unwrap_or(22);
  let handler = ClientHandler {
    app: app.clone(),
    session_id: session_id.clone(),
  };

  let config_russh = russh::client::Config {
    ..Default::default()
  };
  let config_russh = Arc::new(config_russh);

  let mut handle: Handle<ClientHandler> = russh::client::connect(
    config_russh,
    (config.host.as_str(), port),
    handler,
  )
  .await
  .map_err(|e| format!("SSH connect failed: {e}"))?;

  let mut authenticated = false;

  if let Some(key_path) = config.private_key_path.as_deref().filter(|s| !s.is_empty()) {
    let path = expand_key_path(key_path);
    let key_pair = russh_keys::load_secret_key(&path, None)
      .map_err(|e| format!("Failed to load private key {}: {e}", path.display()))?;
    authenticated = handle
      .authenticate_publickey(&config.username, Arc::new(key_pair))
      .await
      .map_err(|e| format!("Public key auth failed: {e}"))?;
  }

  if !authenticated {
    let password = config.password.clone().unwrap_or_default();
    authenticated = handle
      .authenticate_password(&config.username, &password)
      .await
      .map_err(|e| format!("Password auth failed: {e}"))?;
  }

  if !authenticated {
    let _ = app.emit(
      "session-event",
      SessionEvent {
        session_id: session_id.clone(),
        event_type: "ERROR".into(),
        data: None,
        message: None,
        error: Some("All configured authentication methods failed".into()),
        baud_rate: None,
      },
    );
    let _ = handle
      .disconnect(Disconnect::ByApplication, "", "English")
      .await;
    return Err("All configured authentication methods failed".into());
  }

  let _ = app.emit(
    "session-event",
    SessionEvent {
      session_id: session_id.clone(),
      event_type: "STATUS".into(),
      data: None,
      message: Some("Authentication successful, opening shell…".into()),
      error: None,
      baud_rate: None,
    },
  );

  let mut channel = handle
    .channel_open_session()
    .await
    .map_err(|e| format!("Failed to open SSH session channel: {e}"))?;

  channel
    .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
    .await
    .map_err(|e| format!("PTY request failed: {e}"))?;
  channel
    .request_shell(true)
    .await
    .map_err(|e| format!("Shell request failed: {e}"))?;

  let (tx, mut rx) = mpsc::unbounded_channel::<SshCmd>();
  state
    .sessions
    .lock()
    .insert(session_id.clone(), SessionEntry::Ssh { tx });

  let _ = app.emit(
    "session-event",
    SessionEvent {
      session_id: session_id.clone(),
      event_type: "CONNECTED".into(),
      data: None,
      message: Some("SSH connected".into()),
      error: None,
      baud_rate: None,
    },
  );

  let app_task = app.clone();
  let sid_task = session_id.clone();

  tokio::spawn(async move {
    loop {
      tokio::select! {
        cmd = rx.recv() => {
          match cmd {
            Some(SshCmd::Data(bytes)) => {
              if let Err(e) = channel.data(&bytes[..]).await {
                let _ = app_task.emit(
                  "session-event",
                  SessionEvent {
                    session_id: sid_task.clone(),
                    event_type: "ERROR".into(),
                    data: None,
                    message: None,
                    error: Some(format!("SSH write error: {e}")),
                    baud_rate: None,
                  },
                );
                break;
              }
            }
            Some(SshCmd::Resize { rows, cols }) => {
              let _ = channel.window_change(cols, rows, 0, 0).await;
            }
            Some(SshCmd::Close) | None => {
              let _ = channel.eof().await;
              break;
            }
          }
        }
        msg = channel.wait() => {
          match msg {
            Some(ChannelMsg::Data { ref data }) => {
              let text = String::from_utf8_lossy(data).to_string();
              let _ = app_task.emit(
                "session-event",
                SessionEvent {
                  session_id: sid_task.clone(),
                  event_type: "DATA".into(),
                  data: Some(text),
                  message: None,
                  error: None,
                  baud_rate: None,
                },
              );
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
              let text = String::from_utf8_lossy(data).to_string();
              let _ = app_task.emit(
                "session-event",
                SessionEvent {
                  session_id: sid_task.clone(),
                  event_type: "DATA".into(),
                  data: Some(text),
                  message: None,
                  error: None,
                  baud_rate: None,
                },
              );
            }
            Some(ChannelMsg::Eof) | None => {
              let _ = app_task.emit(
                "session-event",
                SessionEvent {
                  session_id: sid_task.clone(),
                  event_type: "DISCONNECTED".into(),
                  data: None,
                  message: Some("SSH disconnected".into()),
                  error: None,
                  baud_rate: None,
                },
              );
              break;
            }
            _ => {}
          }
        }
      }
    }

    let _ = handle
      .disconnect(Disconnect::ByApplication, "", "English")
      .await;
  });

  Ok(())
}

pub fn write_bytes(state: &AppState, session_id: &str, bytes: Vec<u8>) -> Result<(), String> {
  let sessions = state.sessions.lock();
  match sessions.get(session_id) {
    Some(SessionEntry::Ssh { tx }) => tx
      .send(SshCmd::Data(bytes))
      .map_err(|_| "SSH session is closed".to_string()),
    Some(_) => Err("Session is not an SSH connection".into()),
    None => Err("Session not found".into()),
  }
}

pub fn resize(state: &AppState, session_id: &str, rows: u32, cols: u32) -> Result<(), String> {
  let sessions = state.sessions.lock();
  match sessions.get(session_id) {
    Some(SessionEntry::Ssh { tx }) => tx
      .send(SshCmd::Resize { rows, cols })
      .map_err(|_| "SSH session is closed".to_string()),
    Some(_) => Ok(()),
    None => Err("Session not found".into()),
  }
}

// Silence unused import warnings for older russh APIs we may adjust after cargo check
#[allow(dead_code)]
type _Keep = (Channel<Msg>,); 
