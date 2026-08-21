import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { Client } from 'ssh2';
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3001;

type SshAuthBody = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
};

function loadPrivateKey(privateKeyPath?: string): string | undefined {
  if (!privateKeyPath) return undefined;
  try {
    const cleanPath = privateKeyPath.replace(/\$env:USERPROFILE/gi, process.env.USERPROFILE || '');
    if (fs.existsSync(cleanPath)) return fs.readFileSync(cleanPath, 'utf8');
  } catch (e) {
    console.error('Key read error:', e);
  }
  return undefined;
}

function withSftp(
  auth: SshAuthBody,
  run: (sftp: any, conn: Client) => void,
  onError: (err: Error) => void,
) {
  const conn = new Client();
  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) {
        conn.end();
        return onError(err);
      }
      run(sftp, conn);
    });
  });
  conn.on('error', onError);
  conn.connect({
    host: auth.host || '127.0.0.1',
    port: auth.port || 22,
    username: auth.username || 'pi',
    password: auth.password || undefined,
    privateKey: loadPrivateKey(auth.privateKeyPath),
    readyTimeout: 15000,
  });
}

function mapDirEntry(targetDir: string, item: any) {
  return {
    name: item.filename,
    path: path.posix.join(targetDir, item.filename),
    size: item.attrs.size,
    isDir: (item.attrs.mode & 0o40000) === 0o40000,
    permissions: (item.attrs.mode & 0o40000 ? 'd' : '-') + (item.attrs.mode & 0o777).toString(8),
    numericChmod: (item.attrs.mode & 0o777).toString(8),
    modifiedAt: new Date(item.attrs.mtime * 1000).toISOString().slice(0, 16).replace('T', ' '),
  };
}

// API: List Real Physical Serial COM Ports on Host Machine
app.get('/api/serial/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    const formatted = ports.map(p => ({
      path: p.path,
      friendlyName: `${p.manufacturer || 'Serial Device'} (${p.path})`,
      vid: p.vendorId,
      pid: p.productId,
      available: true,
    }));
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: List local filesystem directory
app.get('/api/local/list', (req, res) => {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || 'C:\\';
    let targetDir = typeof req.query.path === 'string' && req.query.path ? req.query.path : home;
    targetDir = path.resolve(targetDir);

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return res.status(400).json({ error: `Not a directory: ${targetDir}` });
    }

    const parent = path.dirname(targetDir);
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const files = [
      ...(parent !== targetDir ? [{
        name: '..',
        path: parent,
        size: 0,
        isDir: true,
        modifiedAt: '',
      }] : []),
      ...entries
        .filter((e) => e.name !== '.' && e.name !== '..')
        .map((e) => {
          const full = path.join(targetDir, e.name);
          let size = 0;
          let modifiedAt = '';
          try {
            const st = fs.statSync(full);
            size = st.isFile() ? st.size : 0;
            modifiedAt = st.mtime.toISOString().slice(0, 16).replace('T', ' ');
          } catch { /* ignore unreadable */ }
          return {
            name: e.name,
            path: full,
            size,
            isDir: e.isDirectory(),
            modifiedAt,
          };
        })
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)),
    ];

    res.json({ path: targetDir, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Real SFTP Remote Directory Listing over SSH
app.post('/api/sftp/list', (req, res) => {
  const { host, port, username, password, privateKeyPath, remotePath } = req.body;
  const targetDir = remotePath || '/home/' + (username || 'pi');

  withSftp(
    { host, port, username, password, privateKeyPath },
    (sftp, conn) => {
      sftp.readdir(targetDir, (readErr: Error | undefined, list: any[]) => {
        conn.end();
        if (readErr) return res.status(500).json({ error: readErr.message });
        const files = list.map((item) => mapDirEntry(targetDir, item));
        // Parent navigation entry
        const parent = path.posix.dirname(targetDir);
        if (parent !== targetDir) {
          files.unshift({
            name: '..',
            path: parent,
            size: 0,
            isDir: true,
            permissions: 'd---',
            numericChmod: '000',
            modifiedAt: '',
          });
        }
        res.json({ path: targetDir, files });
      });
    },
    (err) => res.status(500).json({ error: err.message }),
  );
});

// API: Upload local file to remote SFTP path
app.post('/api/sftp/upload', (req, res) => {
  const { host, port, username, password, privateKeyPath, localPath, remotePath } = req.body;
  if (!localPath || !remotePath) {
    return res.status(400).json({ error: 'localPath and remotePath are required' });
  }
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    return res.status(400).json({ error: `Local file not found: ${localPath}` });
  }

  withSftp(
    { host, port, username, password, privateKeyPath },
    (sftp, conn) => {
      sftp.fastPut(localPath, remotePath, (err: Error | undefined) => {
        conn.end();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, remotePath });
      });
    },
    (err) => res.status(500).json({ error: err.message }),
  );
});

// API: Download remote SFTP file to local path
app.post('/api/sftp/download', (req, res) => {
  const { host, port, username, password, privateKeyPath, remotePath, localPath } = req.body;
  if (!localPath || !remotePath) {
    return res.status(400).json({ error: 'localPath and remotePath are required' });
  }

  const localDir = path.dirname(localPath);
  try {
    fs.mkdirSync(localDir, { recursive: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }

  withSftp(
    { host, port, username, password, privateKeyPath },
    (sftp, conn) => {
      sftp.fastGet(remotePath, localPath, (err: Error | undefined) => {
        conn.end();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, localPath });
      });
    },
    (err) => res.status(500).json({ error: err.message }),
  );
});

// API: chmod on remote SFTP file
app.post('/api/sftp/chmod', (req, res) => {
  const { host, port, username, password, privateKeyPath, remotePath, mode } = req.body;
  if (!remotePath || mode === undefined) {
    return res.status(400).json({ error: 'remotePath and mode are required' });
  }
  const modeNum = typeof mode === 'string' ? parseInt(mode, 8) : Number(mode);
  if (Number.isNaN(modeNum)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  withSftp(
    { host, port, username, password, privateKeyPath },
    (sftp, conn) => {
      sftp.chmod(remotePath, modeNum, (err: Error | undefined) => {
        conn.end();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, remotePath, mode: modeNum.toString(8) });
      });
    },
    (err) => res.status(500).json({ error: err.message }),
  );
});




// ─── WebSocket Handler ───
wss.on('connection', (ws: WebSocket) => {
  console.log('[SSHark Backend] New WebSocket terminal connection requested.');

  let sshClient: Client | null = null;
  let sshStream: any = null; // SSH shell stream reference
  let activeSerialPort: SerialPort | null = null;
  let serialDataHandler: ((chunk: Buffer) => void) | null = null;

  // ─── Single unified message handler for the entire connection lifetime ───
  ws.on('message', (rawMessage) => {
    try {
      const payload = JSON.parse(rawMessage.toString());

      // ── DATA: Forward keystrokes / TX to whichever transport is active ──
      if (payload.type === 'DATA') {
        // Prefer raw byte array for HEX TX (avoids UTF-8 corruption over JSON strings)
        const chunk =
          Array.isArray(payload.bytes)
            ? Buffer.from(payload.bytes.map((b: number) => Number(b) & 0xff))
            : Buffer.from(String(payload.data ?? ''), 'utf8');

        if (sshStream) {
          sshStream.write(chunk);
        } else if (activeSerialPort && activeSerialPort.isOpen) {
          activeSerialPort.write(chunk);
        }
        return;
      }

      // ── RESIZE: Forward terminal resize to SSH stream ──
      if (payload.type === 'RESIZE') {
        if (sshStream) {
          sshStream.setWindow(payload.rows, payload.cols, 0, 0);
        }
        return;
      }

      // ── CHANGE_BAUD: Live baud rate switch without reconnecting ──
      if (payload.type === 'CHANGE_BAUD' && activeSerialPort && activeSerialPort.isOpen) {
        const newBaud = Number(payload.baudRate);
        activeSerialPort.update({ baudRate: newBaud }, (err) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'ERROR', error: `Failed to update baud rate: ${err.message}` }));
          } else {
            console.log(`[SSHark Serial] Updated COM port baud rate to ${newBaud} bps.`);
            ws.send(JSON.stringify({ type: 'BAUD_CHANGED', baudRate: newBaud, message: `--- Serial Port Baud Rate Updated to ${newBaud} bps ---` }));
          }
        });
        return;
      }

      // ── INIT_SERIAL: Open a real physical COM port ──
      if (payload.type === 'INIT_SERIAL') {
        const { path: comPath, baudRate, dataBits, parity, stopBits } = payload.config;
        console.log(`[Serial] Opening ${comPath} at ${baudRate} baud`);

        const releasePreviousPort = (done: () => void) => {
          if (!activeSerialPort) {
            done();
            return;
          }
          try {
            if (serialDataHandler) {
              try { activeSerialPort.off('data', serialDataHandler); } catch {}
              serialDataHandler = null;
            }
            const prev = activeSerialPort;
            activeSerialPort = null;
            if (prev.isOpen) {
              prev.close(() => {
                try { prev.removeAllListeners(); } catch {}
                done();
              });
            } else {
              try { prev.removeAllListeners(); } catch {}
              done();
            }
          } catch {
            activeSerialPort = null;
            done();
          }
        };

        releasePreviousPort(() => {
          try {
            activeSerialPort = new SerialPort({
              path: comPath || 'COM17',
              baudRate: baudRate || 115200,
              dataBits: dataBits || 8,
              parity: parity || 'none',
              stopBits: stopBits || 1,
              autoOpen: false,
            });

            activeSerialPort.open((err) => {
              if (err) {
                console.error(`[SSHark Serial Error] ${err.message}`);
                try { activeSerialPort?.removeAllListeners(); } catch {}
                activeSerialPort = null;
                ws.send(JSON.stringify({ type: 'ERROR', error: `Serial Port ${comPath} Error: ${err.message}` }));
                return;
              }

              ws.send(JSON.stringify({
                type: 'CONNECTED',
                message: `Connected to ${comPath}`,
              }));

              serialDataHandler = (chunk: Buffer) => {
                ws.send(JSON.stringify({ type: 'DATA', data: chunk.toString('utf-8') }));
              };
              activeSerialPort!.on('data', serialDataHandler);

              activeSerialPort!.on('close', () => {
                activeSerialPort = null;
                serialDataHandler = null;
                ws.send(JSON.stringify({ type: 'DISCONNECTED', message: `Serial port ${comPath} closed.` }));
              });
              activeSerialPort!.on('error', (serErr) => {
                ws.send(JSON.stringify({ type: 'ERROR', error: serErr.message }));
              });
            });
          } catch (serInitErr: any) {
            activeSerialPort = null;
            ws.send(JSON.stringify({ type: 'ERROR', error: serInitErr.message }));
          }
        });
        return;
      }

      // ── INIT_SSH: Open a real SSH connection ──
      if (payload.type === 'INIT_SSH') {
        const { host, port, username, password, privateKeyPath } = payload.config;
        const rows = Math.max(2, Number(payload.rows) || 24);
        const cols = Math.max(2, Number(payload.cols) || 80);
        sshClient = new Client();

        sshClient.on('ready', () => {
          ws.send(JSON.stringify({ type: 'STATUS', message: 'SSH Authentication Successful! Spawning shell...' }));
          sshClient!.shell({ term: 'xterm-256color', rows, cols }, (err, stream) => {
            if (err) { ws.send(JSON.stringify({ type: 'ERROR', error: err.message })); return; }

            // Store stream reference so DATA messages can reach it
            sshStream = stream;

            ws.send(JSON.stringify({ type: 'CONNECTED' }));

            stream.on('data', (data: Buffer) => {
              ws.send(JSON.stringify({ type: 'DATA', data: data.toString('utf-8') }));
            });
            stream.on('close', () => {
              sshStream = null;
              ws.send(JSON.stringify({ type: 'DISCONNECTED' }));
              sshClient?.end();
            });
          });
        });
        sshClient.on('error', (err) => {
          ws.send(JSON.stringify({ type: 'ERROR', error: err.message }));
        });

        let privateKey: string | undefined;
        if (privateKeyPath) {
          privateKey = loadPrivateKey(privateKeyPath);
          if (privateKey) console.log(`[SSHark SSH] Loaded Private Key from ${privateKeyPath}`);
        }
        ws.send(JSON.stringify({ type: 'STATUS', message: `Connecting to ${username}@${host}:${port}...` }));
        sshClient.connect({ host, port: port || 22, username, password: password || undefined, privateKey, readyTimeout: 10000 });
        return;
      }

    } catch (e) {
      console.error('WS message parse error:', e);
    }
  });

  ws.on('close', () => {
    sshStream = null;
    if (sshClient) sshClient.end();
    if (activeSerialPort && activeSerialPort.isOpen) activeSerialPort.close();
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  SSHark Real Native Backend Engine listening on ${PORT}`);
  console.log(`  Real SSH | Real SFTP | Real Hardware Serial Enabled`);
  console.log(`=======================================================`);
});
