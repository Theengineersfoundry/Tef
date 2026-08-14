# TermiX desktop (Tauri)

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

This project is not a git repo yet. One-time setup:

1. Create a new **GitHub** repository (empty, no README).
2. In this folder, run:

```bash
git init
git add .
git commit -m "Initial TermiX desktop app"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

3. On GitHub: **Settings → Actions → General → Workflow permissions → Read and write permissions**.
4. Open **Actions → Release → Run workflow**.

GitHub builds all three platforms in parallel. When it finishes:

- **Actions run → Artifacts** — download the zip for each OS
- **Releases** — a draft release `TermiX v1.0.0` with the installers attached (publish when ready)

| OS | File |
|----|------|
| Windows | `TermiX_*_x64-setup.exe` |
| macOS Apple Silicon | `.dmg` / `.app` (aarch64) |
| macOS Intel | `.dmg` / `.app` (x86_64) |
| Linux | `.deb` and `.AppImage` |

macOS builds from GitHub are **unsigned**. Users may need to right-click the app → **Open** the first time. Apple notarization needs a paid Apple Developer account and extra secrets; skip that unless you are distributing widely.

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

## App size

| Artifact | Typical size |
|----------|----------------|
| `termix.exe` (uncompressed) | ~8–14 MB |
| NSIS installer (`.exe` setup) | ~3–5 MB |

SSH/crypto (`russh`) dominates binary size. Release builds use LTO + `opt-level = "z"` + strip. Hard &lt;5 MB for the raw `.exe` needs a non-WebView native rewrite; the compressed installer is already near that range.
