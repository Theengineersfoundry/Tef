use serde::{Deserialize, Serialize};
use serialport::{DataBits, Parity, StopBits};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::state::{AppState, SerialCmd, SessionEntry, SessionEvent};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
  pub path: String,
  pub baud_rate: u32,
  pub data_bits: Option<u8>,
  pub parity: Option<String>,
  pub stop_bits: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
  pub path: String,
  pub friendly_name: String,
  pub vid: Option<String>,
  pub pid: Option<String>,
  pub available: bool,
}

pub fn list_ports() -> Result<Vec<SerialPortInfo>, String> {
  let ports = serialport::available_ports().map_err(|e| e.to_string())?;
  Ok(
    ports
      .into_iter()
      .map(|p| {
        let (vid, pid, manufacturer) = match &p.port_type {
          serialport::SerialPortType::UsbPort(info) => (
            info.vid.to_string().into(),
            info.pid.to_string().into(),
            info.manufacturer
              .clone()
              .unwrap_or_else(|| "USB Serial".into()),
          ),
          _ => (None, None, "Serial Device".into()),
        };
        SerialPortInfo {
          path: p.port_name.clone(),
          friendly_name: format!("{manufacturer} ({})", p.port_name),
          vid,
          pid,
          available: true,
        }
      })
      .collect(),
  )
}

fn map_data_bits(v: Option<u8>) -> DataBits {
  match v.unwrap_or(8) {
    5 => DataBits::Five,
    6 => DataBits::Six,
    7 => DataBits::Seven,
    _ => DataBits::Eight,
  }
}

fn map_parity(v: Option<&str>) -> Parity {
  match v.unwrap_or("none").to_ascii_lowercase().as_str() {
    "even" => Parity::Even,
    "odd" => Parity::Odd,
    _ => Parity::None,
  }
}

fn map_stop_bits(v: Option<u8>) -> StopBits {
  match v.unwrap_or(1) {
    2 => StopBits::Two,
    _ => StopBits::One,
  }
}

pub fn open_serial(
  app: AppHandle,
  state: &AppState,
  session_id: String,
  config: SerialConfig,
) -> Result<(), String> {
  close_if_exists(state, &session_id);

  let baud = if config.baud_rate == 0 {
    115200
  } else {
    config.baud_rate
  };

  let port = serialport::new(&config.path, baud)
    .timeout(Duration::from_millis(50))
    .data_bits(map_data_bits(config.data_bits))
    .parity(map_parity(config.parity.as_deref()))
    .stop_bits(map_stop_bits(config.stop_bits))
    .open()
    .map_err(|e| format!("Failed to open {}: {e}", config.path))?;

  let (tx, mut rx) = mpsc::unbounded_channel::<SerialCmd>();
  let stop = Arc::new(AtomicBool::new(false));
  let stop_reader = stop.clone();
  let stop_writer = stop.clone();
  let app_reader = app.clone();
  let sid_reader = session_id.clone();
  let sid_writer = session_id.clone();
  let app_writer = app.clone();

  let mut port_write = port
    .try_clone()
    .map_err(|e| format!("Serial clone failed: {e}"))?;
  let mut port_read = port;

  // Writer thread: UI → port (+ live baud changes)
  thread::spawn(move || {
    while !stop_writer.load(Ordering::SeqCst) {
      match rx.blocking_recv() {
        Some(SerialCmd::Data(bytes)) => {
          if let Err(e) = port_write.write_all(&bytes) {
            let _ = app_writer.emit(
              "session-event",
              SessionEvent {
                session_id: sid_writer.clone(),
                event_type: "ERROR".into(),
                data: None,
                message: None,
                error: Some(format!("Serial write error: {e}")),
                baud_rate: None,
              },
            );
            break;
          }
          let _ = port_write.flush();
        }
        Some(SerialCmd::SetBaud(new_baud)) => {
          match port_write.set_baud_rate(new_baud) {
            Ok(()) => {
              let _ = app_writer.emit(
                "session-event",
                SessionEvent {
                  session_id: sid_writer.clone(),
                  event_type: "BAUD_CHANGED".into(),
                  data: None,
                  message: Some(format!(
                    "--- Serial Port Baud Rate Updated to {new_baud} bps ---"
                  )),
                  error: None,
                  baud_rate: Some(new_baud),
                },
              );
            }
            Err(e) => {
              let _ = app_writer.emit(
                "session-event",
                SessionEvent {
                  session_id: sid_writer.clone(),
                  event_type: "ERROR".into(),
                  data: None,
                  message: None,
                  error: Some(format!("Baud change failed: {e}")),
                  baud_rate: None,
                },
              );
            }
          }
        }
        None => break,
      }
    }
  });

  // Reader thread: port → UI
  thread::spawn(move || {
    let mut buf = [0u8; 4096];
    while !stop_reader.load(Ordering::SeqCst) {
      match port_read.read(&mut buf) {
        Ok(0) => thread::sleep(Duration::from_millis(5)),
        Ok(n) => {
          let text = String::from_utf8_lossy(&buf[..n]).to_string();
          let _ = app_reader.emit(
            "session-event",
            SessionEvent {
              session_id: sid_reader.clone(),
              event_type: "DATA".into(),
              data: Some(text),
              message: None,
              error: None,
              baud_rate: None,
            },
          );
        }
        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
        Err(e) => {
          let _ = app_reader.emit(
            "session-event",
            SessionEvent {
              session_id: sid_reader.clone(),
              event_type: "ERROR".into(),
              data: None,
              message: None,
              error: Some(format!("Serial read error: {e}")),
              baud_rate: None,
            },
          );
          let _ = app_reader.emit(
            "session-event",
            SessionEvent {
              session_id: sid_reader.clone(),
              event_type: "DISCONNECTED".into(),
              data: None,
              message: Some("Serial port disconnected".into()),
              error: None,
              baud_rate: None,
            },
          );
          break;
        }
      }
    }
  });

  state.sessions.lock().insert(
    session_id.clone(),
    SessionEntry::Serial {
      tx,
      stop: stop.clone(),
    },
  );

  let _ = app.emit(
    "session-event",
    SessionEvent {
      session_id,
      event_type: "CONNECTED".into(),
      data: None,
      message: Some(format!("Serial connected at {baud} baud")),
      error: None,
      baud_rate: Some(baud),
    },
  );

  Ok(())
}

pub fn set_baud(state: &AppState, session_id: &str, baud_rate: u32) -> Result<u32, String> {
  if baud_rate == 0 {
    return Err("Invalid baud rate".into());
  }
  let sessions = state.sessions.lock();
  match sessions.get(session_id) {
    Some(SessionEntry::Serial { tx, .. }) => {
      tx.send(SerialCmd::SetBaud(baud_rate))
        .map_err(|_| "Serial session is closed".to_string())?;
      Ok(baud_rate)
    }
    Some(_) => Err("Session is not a serial connection".into()),
    None => Err("Session not found".into()),
  }
}

pub fn write_bytes(state: &AppState, session_id: &str, bytes: Vec<u8>) -> Result<(), String> {
  let sessions = state.sessions.lock();
  match sessions.get(session_id) {
    Some(SessionEntry::Serial { tx, .. }) => tx
      .send(SerialCmd::Data(bytes))
      .map_err(|_| "Serial session is closed".to_string()),
    Some(_) => Err("Session is not a serial connection".into()),
    None => Err("Session not found".into()),
  }
}

pub fn close_if_exists(state: &AppState, session_id: &str) {
  let mut sessions = state.sessions.lock();
  if let Some(entry) = sessions.remove(session_id) {
    match entry {
      SessionEntry::Serial { stop, .. } => {
        stop.store(true, Ordering::SeqCst);
      }
      SessionEntry::Ssh { tx } => {
        let _ = tx.send(crate::state::SshCmd::Close);
      }
      SessionEntry::Local { tx } => {
        let _ = tx.send(crate::state::LocalCmd::Close);
      }
    }
  }
}
