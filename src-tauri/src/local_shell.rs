use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::state::{AppState, LocalCmd, SessionEntry, SessionEvent};

fn shell_command() -> CommandBuilder {
  // Prefer PowerShell on Windows; fall back to cmd.
  #[cfg(windows)]
  {
    let candidates = ["pwsh.exe", "powershell.exe", "cmd.exe"];
    for name in candidates {
      if which_exists(name) {
        let mut cmd = CommandBuilder::new(name);
        if name != "cmd.exe" {
          cmd.arg("-NoLogo");
          cmd.arg("-NoExit");
          cmd.arg("-Command");
          cmd.arg("Remove-Module PSReadLine -ErrorAction SilentlyContinue; Clear-Host");
        }
        cmd.env("TERM", "xterm-256color");
        return cmd;
      }
    }
    let mut cmd = CommandBuilder::new("cmd.exe");
    cmd.env("TERM", "xterm-256color");
    cmd
  }
  #[cfg(not(windows))]
  {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    cmd
  }
}

#[cfg(windows)]
fn which_exists(name: &str) -> bool {
  std::env::var_os("PATH")
    .map(|paths| {
      std::env::split_paths(&paths).any(|dir| {
        let p = dir.join(name);
        p.is_file()
      })
    })
    .unwrap_or(false)
}

pub fn open_local(
  app: AppHandle,
  state: &AppState,
  session_id: String,
  rows: Option<u32>,
  cols: Option<u32>,
) -> Result<(), String> {
  crate::serial::close_if_exists(state, &session_id);

  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: rows.unwrap_or(24) as u16,
      cols: cols.unwrap_or(80) as u16,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("Failed to open PTY: {e}"))?;

  let cmd = shell_command();
  let mut child = pair
    .slave
    .spawn_command(cmd)
    .map_err(|e| format!("Failed to start local shell: {e}"))?;
  // Required so the child owns the console; otherwise ConPTY can exit immediately.
  drop(pair.slave);

  let mut reader = pair
    .master
    .try_clone_reader()
    .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
  let writer = pair
    .master
    .take_writer()
    .map_err(|e| format!("Failed to take PTY writer: {e}"))?;
  let master: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pair.master));
  let writer = Arc::new(Mutex::new(writer));

  let (tx, mut rx) = mpsc::unbounded_channel::<LocalCmd>();
  {
    let mut sessions = state.sessions.lock();
    sessions.insert(session_id.clone(), SessionEntry::Local { tx });
  }

  let _ = app.emit(
    "session-event",
    SessionEvent {
      session_id: session_id.clone(),
      event_type: "CONNECTED".into(),
      data: None,
      message: Some("Local shell connected".into()),
      error: None,
      baud_rate: None,
    },
  );

  let app_read = app.clone();
  let sid_read = session_id.clone();
  thread::spawn(move || {
    let mut buf = [0u8; 8192];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          let text = String::from_utf8_lossy(&buf[..n]).to_string();
          let _ = app_read.emit(
            "session-event",
            SessionEvent {
              session_id: sid_read.clone(),
              event_type: "DATA".into(),
              data: Some(text),
              message: None,
              error: None,
              baud_rate: None,
            },
          );
        }
        Err(_) => break,
      }
    }

    let _ = app_read.emit(
      "session-event",
      SessionEvent {
        session_id: sid_read,
        event_type: "DISCONNECTED".into(),
        data: None,
        message: Some("Local shell exited".into()),
        error: None,
        baud_rate: None,
      },
    );
  });

  let writer_cmd = writer.clone();
  let master_cmd = master.clone();
  let app_cmd = app.clone();
  let sid_cmd = session_id.clone();
  thread::spawn(move || {
    while let Some(cmd) = rx.blocking_recv() {
      match cmd {
        LocalCmd::Data(bytes) => {
          let mut w = match writer_cmd.lock() {
            Ok(w) => w,
            Err(_) => break,
          };
          if w.write_all(&bytes).is_err() || w.flush().is_err() {
            let _ = app_cmd.emit(
              "session-event",
              SessionEvent {
                session_id: sid_cmd.clone(),
                event_type: "ERROR".into(),
                data: None,
                message: None,
                error: Some("Local shell write failed".into()),
                baud_rate: None,
              },
            );
            break;
          }
        }
        LocalCmd::Resize { rows, cols } => {
          if let Ok(m) = master_cmd.lock() {
            let _ = m.resize(PtySize {
              rows: rows as u16,
              cols: cols as u16,
              pixel_width: 0,
              pixel_height: 0,
            });
          }
        }
        LocalCmd::Close => break,
      }
    }

    // Drop writer to signal EOF; kill child if still running.
    drop(writer_cmd);
    let _ = child.kill();
    let _ = child.wait();
  });

  Ok(())
}

pub fn write_bytes(state: &AppState, session_id: &str, bytes: Vec<u8>) -> Result<(), String> {
  let sessions = state.sessions.lock();
  match sessions.get(session_id) {
    Some(SessionEntry::Local { tx }) => tx
      .send(LocalCmd::Data(bytes))
      .map_err(|_| "Local session is closed".to_string()),
    Some(_) => Err("Session is not a local shell".into()),
    None => Err("Session not found".into()),
  }
}

pub fn resize(state: &AppState, session_id: &str, rows: u32, cols: u32) -> Result<(), String> {
  let sessions = state.sessions.lock();
  match sessions.get(session_id) {
    Some(SessionEntry::Local { tx }) => tx
      .send(LocalCmd::Resize { rows, cols })
      .map_err(|_| "Local session is closed".to_string()),
    Some(_) => Ok(()),
    None => Err("Session not found".into()),
  }
}
