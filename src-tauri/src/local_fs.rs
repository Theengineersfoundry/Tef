use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
  pub name: String,
  pub path: String,
  pub size: u64,
  pub is_dir: bool,
  pub modified_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
  pub path: String,
  pub files: Vec<FileItem>,
}

pub fn list_dir(path: Option<String>) -> Result<DirListing, String> {
  let home = dirs::home_dir()
    .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
    .unwrap_or_else(|| PathBuf::from("C:\\"));

  let target = match path {
    Some(p) if !p.trim().is_empty() => PathBuf::from(p),
    _ => home,
  };
  let target = fs::canonicalize(&target).unwrap_or(target);

  if !target.is_dir() {
    return Err(format!("Not a directory: {}", target.display()));
  }

  let mut files = Vec::new();
  if let Some(parent) = target.parent() {
    if parent != target {
      files.push(FileItem {
        name: "..".into(),
        path: parent.to_string_lossy().into(),
        size: 0,
        is_dir: true,
        modified_at: String::new(),
      });
    }
  }

  let entries = fs::read_dir(&target).map_err(|e| e.to_string())?;
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name == "." || name == ".." {
      continue;
    }
    let full = entry.path();
    let meta = entry.metadata().ok();
    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size = meta
      .as_ref()
      .map(|m| if m.is_file() { m.len() } else { 0 })
      .unwrap_or(0);

    files.push(FileItem {
      name,
      path: full.to_string_lossy().into(),
      size,
      is_dir,
      modified_at: String::new(),
    });
  }

  files.sort_by(|a, b| {
    b.is_dir
      .cmp(&a.is_dir)
      .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
  });

  Ok(DirListing {
    path: target.to_string_lossy().into(),
    files,
  })
}
