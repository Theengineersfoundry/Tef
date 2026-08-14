use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;

pub struct AppState {
  pub sessions: Mutex<HashMap<String, SessionEntry>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      sessions: Mutex::new(HashMap::new()),
    }
  }
}

pub enum SessionEntry {
  Serial {
    tx: mpsc::UnboundedSender<SerialCmd>,
    stop: Arc<std::sync::atomic::AtomicBool>,
  },
  Ssh {
    tx: mpsc::UnboundedSender<SshCmd>,
  },
  Local {
    tx: mpsc::UnboundedSender<LocalCmd>,
  },
}

pub enum SerialCmd {
  Data(Vec<u8>),
  SetBaud(u32),
}

pub enum SshCmd {
  Data(Vec<u8>),
  Resize { rows: u32, cols: u32 },
  Close,
}

pub enum LocalCmd {
  Data(Vec<u8>),
  Resize { rows: u32, cols: u32 },
  Close,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
  pub session_id: String,
  #[serde(rename = "type")]
  pub event_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub data: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub message: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub baud_rate: Option<u32>,
}
