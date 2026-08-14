# Tef desktop (Tauri)

## Run in development

```bash
npm install
npm run tauri:dev
```

This starts Vite + the Tauri window. SSH and Serial talk to the **Rust backend** (no Node server required).

## Browser mode (old path, still works)

```bash
npm run server
npm run dev
```

Uses `ws://localhost:3001` (Express). Same features as Tauri, including SFTP.

## Production build (this Windows PC)

```bash
npm run tauri:build
```

Installer output: `src-tauri/target/release/bundle/nsis/`

## Build Windows, macOS, and Linux on GitHub

On GitHub: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

Then **Actions → Release → Run workflow**.

GitHub builds all three platforms in parallel. When it finishes:

- **Actions run → Artifacts** — download the zip for each OS
- **Releases** — a draft release `Tef v1.0.0` with the installers attached (publish when ready)

| OS | File |
|----|------|
| Windows | `Tef_*_x64-setup.exe` |
| macOS Apple Silicon | `.dmg` / `.app` (aarch64) |
| macOS Intel | `.dmg` / `.app` (x86_64) |
| Linux | `.deb` and `.AppImage` |

macOS builds from GitHub are **unsigned**. Users may need to right-click the app → **Open** the first time.

To cut a versioned release later:

```bash
git tag v1.0.1
git push origin v1.0.1
```

## Status

| Feature | Tauri Rust | Node server (browser) |
|---------|------------|------------------------|
| SSH shell | Yes | Yes |
| Serial | Yes | Yes |
| SFTP file browser | Yes | Yes |
| Same React UI | Yes | Yes |

Requires **Windows 10/11** with **WebView2** (usually preinstalled).
