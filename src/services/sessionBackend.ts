import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Session backend abstraction:
 * - Inside Tauri desktop → Rust invoke + session-event
 * - Browser / Electron-with-Node → existing ws://localhost:3001
 */

export type SessionEventType =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'DATA'
  | 'ERROR'
  | 'STATUS'
  | 'BAUD_CHANGED';

export type SessionEvent = {
  sessionId: string;
  type: SessionEventType;
  data?: string;
  message?: string;
  error?: string;
  baudRate?: number;
};

export type SerialOpenConfig = {
  path: string;
  baudRate: number;
  dataBits?: number;
  parity?: string;
  stopBits?: number;
};

export type SshOpenConfig = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  rows?: number;
  cols?: number;
};

type SessionListener = (event: SessionEvent) => void;

const listeners = new Set<SessionListener>();
let tauriUnlisten: (() => void) | null = null;
let tauriInitPromise: Promise<void> | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function onSessionEvent(listener: SessionListener): () => void {
  listeners.add(listener);
  void ensureTauriListener();
  return () => {
    listeners.delete(listener);
  };
}

function emitLocal(event: SessionEvent) {
  listeners.forEach((l) => {
    try {
      l(event);
    } catch {
      /* ignore listener errors */
    }
  });
}

async function ensureTauriListener() {
  if (!isTauriRuntime() || tauriUnlisten) return;
  if (tauriInitPromise) return tauriInitPromise;

  tauriInitPromise = (async () => {
    tauriUnlisten = await listen<SessionEvent>('session-event', (ev) => {
      emitLocal(ev.payload);
    });
  })();

  return tauriInitPromise;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export async function listSerialPorts(): Promise<
  Array<{ path: string; friendlyName: string; vid?: string; pid?: string; available: boolean }>
> {
  if (isTauriRuntime()) {
    return invokeTauri('list_serial_ports');
  }
  const res = await fetch('http://localhost:3001/api/serial/ports');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function openSerialSession(sessionId: string, config: SerialOpenConfig): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('openSerialSession is only used in Tauri mode');
  }
  await ensureTauriListener();
  await invokeTauri('session_open_serial', {
    sessionId,
    config: {
      path: config.path,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      parity: config.parity,
      stopBits: config.stopBits,
    },
  });
}

export async function openSshSession(sessionId: string, config: SshOpenConfig): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('openSshSession is only used in Tauri mode');
  }
  await ensureTauriListener();
  await invokeTauri('session_open_ssh', {
    sessionId,
    config: {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKeyPath: config.privateKeyPath,
      rows: config.rows ?? null,
      cols: config.cols ?? null,
    },
  });
}

export async function openLocalSession(
  sessionId: string,
  size?: { rows?: number; cols?: number }
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('openLocalSession is only used in Tauri mode');
  }
  await ensureTauriListener();
  await invokeTauri('session_open_local', {
    sessionId,
    rows: size?.rows ?? null,
    cols: size?.cols ?? null,
  });
}

export async function writeSession(
  sessionId: string,
  payload: { data?: string; bytes?: number[] }
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('writeSession is only used in Tauri mode');
  }
  await invokeTauri('session_write', {
    payload: {
      sessionId,
      data: payload.data,
      bytes: payload.bytes,
    },
  });
}

export async function resizeSession(sessionId: string, rows: number, cols: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeTauri('session_resize', { sessionId, rows, cols });
}

export async function setSessionBaud(sessionId: string, baudRate: number): Promise<number> {
  if (!isTauriRuntime()) {
    throw new Error('setSessionBaud is only used in Tauri mode');
  }
  return invokeTauri('session_set_baud', { sessionId, baudRate });
}

export async function closeSession(sessionId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeTauri('session_close', { sessionId });
}

/** Native OS clipboard — no browser permission prompt in Tauri. */
export async function writeClipboardText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri('clipboard_write', { text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function readClipboardText(): Promise<string> {
  if (isTauriRuntime()) {
    return invokeTauri('clipboard_read');
  }
  return navigator.clipboard.readText();
}

/** Save text via native Save As (Tauri) or a browser download. Returns false if cancelled. */
export async function saveTextFile(defaultName: string, contents: string): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      await invokeTauri('save_text_file', { defaultName, contents });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('cancelled')) return false;
      throw err;
    }
  }
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = defaultName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}

/** Open a .json file via native picker (Tauri) or a hidden file input. Returns null if cancelled. */
export async function pickJsonFile(): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      return await invokeTauri<string>('pick_json_file');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('cancelled')) return null;
      throw err;
    }
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (!file.name.toLowerCase().endsWith('.json')) {
        reject(new Error('Only .json files are allowed'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.readAsText(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function localList(path?: string): Promise<{ path: string; files: any[] }> {
  if (isTauriRuntime()) {
    return invokeTauri('local_list', { path: path ?? null });
  }
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`http://localhost:3001/api/local/list${q}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type SftpAuth = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
};

export async function sftpList(
  auth: SftpAuth,
  remotePath?: string
): Promise<{ path: string; files: any[] }> {
  if (isTauriRuntime()) {
    return invokeTauri('sftp_list', { auth, remotePath: remotePath ?? null });
  }
  const res = await fetch('http://localhost:3001/api/sftp/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, remotePath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch remote directory');
  return data;
}

export async function sftpUpload(
  auth: SftpAuth,
  localPath: string,
  remotePath: string
): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri('sftp_upload', { auth, localPath, remotePath });
    return;
  }
  const res = await fetch('http://localhost:3001/api/sftp/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, localPath, remotePath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
}

export async function sftpDownload(
  auth: SftpAuth,
  remotePath: string,
  localPath: string
): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri('sftp_download', { auth, remotePath, localPath });
    return;
  }
  const res = await fetch('http://localhost:3001/api/sftp/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, remotePath, localPath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Download failed');
}

export async function sftpChmod(auth: SftpAuth, remotePath: string, mode: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri('sftp_chmod', { auth, remotePath, mode });
    return;
  }
  const res = await fetch('http://localhost:3001/api/sftp/chmod', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, remotePath, mode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'chmod failed');
}
