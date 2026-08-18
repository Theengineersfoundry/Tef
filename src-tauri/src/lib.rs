mod commands;
mod serial;
mod ssh;
mod state;
mod local_fs;
mod local_shell;
mod sftp;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::list_serial_ports,
      commands::session_open_serial,
      commands::session_open_ssh,
      commands::session_open_local,
      commands::session_write,
      commands::session_resize,
      commands::session_set_baud,
      commands::session_close,
      commands::clipboard_write,
      commands::clipboard_read,
      commands::save_text_file,
      commands::pick_json_file,
      commands::local_list,
      commands::sftp_list,
      commands::sftp_upload,
      commands::sftp_download,
      commands::sftp_chmod,
    ])
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // macOS: red traffic light hides; app stays in the Dock (Cmd+Q quits).
        if cfg!(target_os = "macos") {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building SSHark")
    .run(|app, event| {
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen {
        has_visible_windows, ..
      } = &event
      {
        if !has_visible_windows {
          if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
          }
        }
      }
      let _ = (app, event);
    });
}
