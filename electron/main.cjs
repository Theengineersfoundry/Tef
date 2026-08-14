const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let backendProcess = null;

function resolveBackendLaunch() {
  const root = path.join(__dirname, '..');
  const jsPath = path.join(root, 'server', 'index.js');
  const cjsPath = path.join(root, 'server', 'index.cjs');
  const tsPath = path.join(root, 'server', 'index.ts');
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  if (fs.existsSync(jsPath)) {
    return { command: 'node', args: [jsPath] };
  }
  if (fs.existsSync(cjsPath)) {
    return { command: 'node', args: [cjsPath] };
  }
  if (fs.existsSync(tsxCli) && fs.existsSync(tsPath)) {
    return { command: 'node', args: [tsxCli, tsPath] };
  }
  return { command: 'npx', args: ['tsx', tsPath] };
}

function startBackend() {
  const { command, args } = resolveBackendLaunch();
  console.log(`[Tef Electron] Starting backend: ${command} ${args.join(' ')}`);
  backendProcess = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: path.join(__dirname, '..'),
  });
  backendProcess.on('error', (err) => {
    console.error('[Tef Electron] Backend failed to start:', err.message);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Tef - Open-Source PuTTY Replacement',
    icon: path.join(__dirname, '../public/favicon.svg'),
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      // UI talks to the local backend over HTTP/WS only — no Node in renderer
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
  if (isDev && !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
