use tauri::{AppHandle, State};

use crate::local_fs;
use crate::local_shell;
use crate::serial::{self, SerialConfig};
use crate::sftp::{self, SftpAuth};
use crate::ssh::{self, SshConfig};
use crate::state::{AppState, SessionEntry};

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<serial::SerialPortInfo>, String> {
  serial::list_ports()
}

#[tauri::command]
pub async fn session_open_serial(
  app: AppHandle,
  state: State<'_, AppState>,
  session_id: String,
  config: SerialConfig,
) -> Result<(), String> {
  serial::open_serial(app, state.inner(), session_id, config)
}

#[tauri::command]
pub async fn session_open_ssh(
  app: AppHandle,
  state: State<'_, AppState>,
  session_id: String,
  config: SshConfig,
) -> Result<(), String> {
  ssh::open_ssh(app, state.inner(), session_id, config).await
}

#[tauri::command]
pub fn session_open_local(
  app: AppHandle,
  state: State<'_, AppState>,
  session_id: String,
  rows: Option<u32>,
  cols: Option<u32>,
) -> Result<(), String> {
  local_shell::open_local(app, state.inner(), session_id, rows, cols)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritePayload {
  pub session_id: String,
  pub data: Option<String>,
  pub bytes: Option<Vec<u8>>,
}

#[tauri::command]
pub fn session_write(state: State<'_, AppState>, payload: WritePayload) -> Result<(), String> {
  let bytes = if let Some(b) = payload.bytes {
    b
  } else {
    payload.data.unwrap_or_default().into_bytes()
  };

  let sessions = state.sessions.lock();
  let kind = sessions.get(&payload.session_id).map(|e| match e {
    SessionEntry::Serial { .. } => "serial",
    SessionEntry::Ssh { .. } => "ssh",
    SessionEntry::Local { .. } => "local",
  });
  drop(sessions);

  match kind {
    Some("serial") => serial::write_bytes(state.inner(), &payload.session_id, bytes),
    Some("local") => local_shell::write_bytes(state.inner(), &payload.session_id, bytes),
    Some("ssh") => ssh::write_bytes(state.inner(), &payload.session_id, bytes),
    _ => Err("Session not found".into()),
  }
}

#[tauri::command]
pub fn session_resize(
  state: State<'_, AppState>,
  session_id: String,
  rows: u32,
  cols: u32,
) -> Result<(), String> {
  let sessions = state.sessions.lock();
  let is_local = matches!(
    sessions.get(&session_id),
    Some(SessionEntry::Local { .. })
  );
  drop(sessions);

  if is_local {
    local_shell::resize(state.inner(), &session_id, rows, cols)
  } else {
    ssh::resize(state.inner(), &session_id, rows, cols)
  }
}

#[tauri::command]
pub fn session_set_baud(
  state: State<'_, AppState>,
  session_id: String,
  baud_rate: u32,
) -> Result<u32, String> {
  serial::set_baud(state.inner(), &session_id, baud_rate)
}

#[tauri::command]
pub fn session_close(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
  serial::close_if_exists(state.inner(), &session_id);
  Ok(())
}

#[tauri::command]
pub fn clipboard_write(text: String) -> Result<(), String> {
  arboard::Clipboard::new()
    .map_err(|e| e.to_string())?
    .set_text(text)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_read() -> Result<String, String> {
  arboard::Clipboard::new()
    .map_err(|e| e.to_string())?
    .get_text()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_list(path: Option<String>) -> Result<local_fs::DirListing, String> {
  local_fs::list_dir(path)
}

#[tauri::command]
pub async fn sftp_list(
  auth: SftpAuth,
  remote_path: Option<String>,
) -> Result<sftp::RemoteDirListing, String> {
  sftp::list_remote(auth, remote_path).await
}

#[tauri::command]
pub async fn sftp_upload(
  auth: SftpAuth,
  local_path: String,
  remote_path: String,
) -> Result<(), String> {
  sftp::upload_file(auth, local_path, remote_path).await
}

#[tauri::command]
pub async fn sftp_download(
  auth: SftpAuth,
  remote_path: String,
  local_path: String,
) -> Result<(), String> {
  sftp::download_file(auth, remote_path, local_path).await
}

#[tauri::command]
pub async fn sftp_chmod(
  auth: SftpAuth,
  remote_path: String,
  mode: String,
) -> Result<(), String> {
  sftp::chmod_remote(auth, remote_path, mode).await
}
