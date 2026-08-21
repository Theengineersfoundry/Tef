use async_trait::async_trait;
use russh::client::{Handler, Msg};
use russh::{ChannelId, Disconnect};
use russh_keys::key;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::ssh::SshConfig;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpAuth {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub password: Option<String>,
  pub private_key_path: Option<String>,
}

impl From<SftpAuth> for SshConfig {
  fn from(a: SftpAuth) -> Self {
    SshConfig {
      host: a.host,
      port: a.port,
      username: a.username,
      password: a.password,
      private_key_path: a.private_key_path,
      rows: None,
      cols: None,
    }
  }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileItem {
  pub name: String,
  pub path: String,
  pub size: u64,
  pub is_dir: bool,
  pub permissions: String,
  pub numeric_chmod: String,
  pub modified_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirListing {
  pub path: String,
  pub files: Vec<RemoteFileItem>,
}

struct QuietHandler;

#[async_trait]
impl Handler for QuietHandler {
  type Error = russh::Error;

  async fn check_server_key(
    &mut self,
    _server_public_key: &key::PublicKey,
  ) -> Result<bool, Self::Error> {
    Ok(true)
  }

  async fn data(
    &mut self,
    _channel: ChannelId,
    _data: &[u8],
    _session: &mut russh::client::Session,
  ) -> Result<(), Self::Error> {
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

fn posix_join(base: &str, name: &str) -> String {
  if base == "/" {
    format!("/{name}")
  } else {
    format!("{}/{name}", base.trim_end_matches('/'))
  }
}

fn posix_parent(path: &str) -> Option<String> {
  if path == "/" {
    return None;
  }
  let trimmed = path.trim_end_matches('/');
  match trimmed.rfind('/') {
    Some(0) => Some("/".into()),
    Some(i) => Some(trimmed[..i].into()),
    None => Some("/".into()),
  }
}

fn format_mode(is_dir: bool, mode: u32) -> (String, String) {
  let perms = mode & 0o777;
  let numeric = format!("{perms:03o}");
  let prefix = if is_dir { 'd' } else { '-' };
  (format!("{prefix}{numeric}"), numeric)
}

async fn open_sftp_session(
  config: &SshConfig,
) -> Result<(russh::client::Handle<QuietHandler>, SftpSession), String> {
  let port = config.port.unwrap_or(22);
  let russh_cfg = Arc::new(russh::client::Config::default());

  let mut handle = russh::client::connect(russh_cfg, (config.host.as_str(), port), QuietHandler)
    .await
    .map_err(|e| format!("SFTP connect failed: {e}"))?;

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
    let _ = handle
      .disconnect(Disconnect::ByApplication, "", "English")
      .await;
    return Err("All configured authentication methods failed".into());
  }

  let channel = handle
    .channel_open_session()
    .await
    .map_err(|e| format!("Failed to open SFTP channel: {e}"))?;

  channel
    .request_subsystem(true, "sftp")
    .await
    .map_err(|e| format!("SFTP subsystem request failed: {e}"))?;

  let sftp = SftpSession::new(channel.into_stream())
    .await
    .map_err(|e| format!("SFTP session init failed: {e}"))?;

  Ok((handle, sftp))
}

pub async fn list_remote(
  auth: SftpAuth,
  remote_path: Option<String>,
) -> Result<RemoteDirListing, String> {
  let config: SshConfig = auth.into();
  let default_path = format!("/home/{}", config.username);
  let target = remote_path
    .filter(|p| !p.trim().is_empty())
    .unwrap_or(default_path);

  let (handle, sftp) = open_sftp_session(&config).await?;

  let mut files = Vec::new();
  if let Some(parent) = posix_parent(&target) {
    if parent != target {
      files.push(RemoteFileItem {
        name: "..".into(),
        path: parent,
        size: 0,
        is_dir: true,
        permissions: "d000".into(),
        numeric_chmod: "000".into(),
        modified_at: String::new(),
      });
    }
  }

  let entries = sftp
    .read_dir(&target)
    .await
    .map_err(|e| format!("Failed to list {target}: {e}"))?;

  for entry in entries {
    let name = entry.file_name();
    if name == "." || name == ".." {
      continue;
    }
    let meta = entry.metadata();
    let is_dir = meta.file_type().is_dir();
    let mode = meta.permissions.unwrap_or(0);
    let (permissions, numeric_chmod) = format_mode(is_dir, mode);
    let size = meta.size.unwrap_or(0);
    let modified_at = meta
      .mtime
      .map(|t| {
        // lightweight ISO-ish stamp
        let secs = t as i64;
        format!("{secs}")
      })
      .unwrap_or_default();

    files.push(RemoteFileItem {
      name: name.clone(),
      path: posix_join(&target, &name),
      size,
      is_dir,
      permissions,
      numeric_chmod,
      modified_at,
    });
  }

  files.sort_by(|a, b| {
    b.is_dir
      .cmp(&a.is_dir)
      .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
  });

  let _ = handle
    .disconnect(Disconnect::ByApplication, "", "English")
    .await;

  Ok(RemoteDirListing {
    path: target,
    files,
  })
}

pub async fn upload_file(
  auth: SftpAuth,
  local_path: String,
  remote_path: String,
) -> Result<(), String> {
  let config: SshConfig = auth.into();
  let local = PathBuf::from(&local_path);
  if !local.is_file() {
    return Err(format!("Local file not found: {local_path}"));
  }

  let (handle, sftp) = open_sftp_session(&config).await?;
  let data = fs::read(&local)
    .await
    .map_err(|e| format!("Failed to read local file: {e}"))?;

  let mut remote = sftp
    .create(&remote_path)
    .await
    .map_err(|e| format!("Failed to create remote file {remote_path}: {e}"))?;

  remote
    .write_all(&data)
    .await
    .map_err(|e| format!("Failed to write remote file: {e}"))?;
  remote
    .flush()
    .await
    .map_err(|e| format!("Failed to flush remote file: {e}"))?;
  let _ = remote.shutdown().await;

  let _ = handle
    .disconnect(Disconnect::ByApplication, "", "English")
    .await;
  Ok(())
}

pub async fn download_file(
  auth: SftpAuth,
  remote_path: String,
  local_path: String,
) -> Result<(), String> {
  let config: SshConfig = auth.into();
  let local = PathBuf::from(&local_path);
  if let Some(parent) = local.parent() {
    fs::create_dir_all(parent)
      .await
      .map_err(|e| format!("Failed to create local directory: {e}"))?;
  }

  let (handle, sftp) = open_sftp_session(&config).await?;
  let mut remote = sftp
    .open(&remote_path)
    .await
    .map_err(|e| format!("Failed to open remote file {remote_path}: {e}"))?;

  let mut buf = Vec::new();
  remote
    .read_to_end(&mut buf)
    .await
    .map_err(|e| format!("Failed to read remote file: {e}"))?;
  let _ = remote.shutdown().await;

  fs::write(&local, &buf)
    .await
    .map_err(|e| format!("Failed to write local file: {e}"))?;

  let _ = handle
    .disconnect(Disconnect::ByApplication, "", "English")
    .await;
  Ok(())
}

pub async fn chmod_remote(
  auth: SftpAuth,
  remote_path: String,
  mode: String,
) -> Result<(), String> {
  let config: SshConfig = auth.into();
  let mode_num = u32::from_str_radix(mode.trim(), 8)
    .map_err(|_| format!("Invalid mode: {mode}"))?;

  let (handle, sftp) = open_sftp_session(&config).await?;

  let mut attrs = sftp
    .metadata(&remote_path)
    .await
    .map_err(|e| format!("Failed to stat {remote_path}: {e}"))?;
  attrs.permissions = Some(mode_num);

  sftp
    .set_metadata(&remote_path, attrs)
    .await
    .map_err(|e| format!("Failed to chmod {remote_path}: {e}"))?;

  let _ = handle
    .disconnect(Disconnect::ByApplication, "", "English")
    .await;
  Ok(())
}

#[allow(dead_code)]
fn _path_is_file(p: &Path) -> bool {
  p.is_file()
}

// Keep Msg import quiet if unused on some russh builds
#[allow(dead_code)]
type _Keep = Msg;
