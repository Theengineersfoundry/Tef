mod commands;
mod serial;
mod ssh;
mod state;
mod local_fs;
mod local_shell;
mod sftp;

use state::AppState;

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
    .run(tauri::generate_context!())
    .expect("error while running Tef");
}
