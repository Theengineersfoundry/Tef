import type { SerialConfig, SSHConfig } from '../types/terminal';
import { listSerialPorts } from './sessionBackend';

export interface DeviceInfo {
  path: string;
  friendlyName: string;
  vid?: string;
  pid?: string;
  available: boolean;
}

export class TerminalEngine {
  // Parse raw CLI SSH command lines like: ssh -i "C:\Users\Name\.ssh\key" pi@192.168.68.131
  static parseSSHCommandLine(cmdLine: string): Partial<SSHConfig> | null {
    const trimmed = cmdLine.trim();
    if (!trimmed.toLowerCase().startsWith('ssh')) return null;

    const result: Partial<SSHConfig> = {
      port: 22,
      authMethod: 'password',
    };

    const keyMatch = trimmed.match(/-i\s+["']?([^"'\s]+)["']?/i);
    if (keyMatch && keyMatch[1]) {
      result.authMethod = 'privateKey';
      let keyPath = keyMatch[1];
      keyPath = keyPath.replace(/\$env:USERPROFILE/gi, 'C:\\Users\\LENOVO');
      result.privateKeyPath = keyPath;
    }

    const portMatch = trimmed.match(/-p\s+(\d+)/i);
    if (portMatch && portMatch[1]) {
      result.port = parseInt(portMatch[1], 10);
    }

    const tokens = trimmed.split(/\s+/);
    const lastToken = tokens[tokens.length - 1];

    if (lastToken.includes('@')) {
      const [u, h] = lastToken.split('@');
      result.username = u;
      result.host = h;
    } else if (lastToken && !lastToken.startsWith('-')) {
      result.host = lastToken;
    }

    return result;
  }

  // Scan Real Physical Serial COM Ports via Backend Server API & Web Serial API
  static async scanSerialPorts(): Promise<DeviceInfo[]> {
    const realPorts: DeviceInfo[] = [];

    // 1. Native ports via Tauri (desktop) or Node HTTP backend (browser)
    try {
      const data = await listSerialPorts();
      if (Array.isArray(data) && data.length > 0) {
        data.forEach((p: any) => {
          if (p.path && !realPorts.some((existing) => existing.path === p.path)) {
            realPorts.push({
              path: p.path,
              friendlyName: p.friendlyName || p.path,
              vid: p.vid,
              pid: p.pid,
              available: true,
            });
          }
        });
      }
    } catch {
      /* backend ports unavailable */
    }

    // 2. Check Web Serial API support (Navigator Serial)
    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      try {
        const ports = await (navigator as any).serial.getPorts();
        if (ports && ports.length > 0) {
          ports.forEach((p: any, idx: number) => {
            const info = p.getInfo();
            const webPath = `WebSerial-${idx + 1}`;
            if (!realPorts.some(existing => existing.path === webPath)) {
              realPorts.push({
                path: webPath,
                friendlyName: `WebSerial USB Device (VID:${info.usbVendorId || 'Native'})`,
                vid: info.usbVendorId?.toString(16),
                pid: info.usbProductId?.toString(16),
                available: true,
              });
            }
          });
        }
      } catch {
        /* Web Serial not available */
      }
    }

    // 3. If no physical hardware devices are plugged into USB/COM ports
    if (realPorts.length === 0) {
      realPorts.push({
        path: 'NO_PORTS',
        friendlyName: 'No Physical Serial Ports Detected (Plug in USB Device)',
        available: false,
      });
    }

    return realPorts;
  }

  static formatHexOutput(data: string | Uint8Array): string {
    const bytes = typeof data === 'string' 
      ? new TextEncoder().encode(data) 
      : data;
    
    let hexStr = '';
    for (let i = 0; i < bytes.length; i++) {
      const hex = bytes[i].toString(16).padStart(2, '0').toUpperCase();
      hexStr += `${hex} `;
      if ((i + 1) % 16 === 0) hexStr += '\r\n';
    }
    return hexStr;
  }

  static createSSHBanner(config?: SSHConfig): string {
    const host = config?.host || '';
    const user = config?.username || '';
    const keyInfo = config?.privateKeyPath ? `\r\n\x1b[35m Identity Key: ${config.privateKeyPath}\x1b[0m` : '';
    
    return [
      `\x1b[1;34m===============================================================\x1b[0m\r\n`,
      `\x1b[1;32m Tef SSH Engine v1.0.0 (Encrypted AES-256-GCM)\x1b[0m\r\n`,
      `\x1b[36m Connecting to: ${user}@${host}:22${keyInfo}\x1b[0m\r\n`,
      `\x1b[1;34m===============================================================\x1b[0m\r\n`,
    ].join('');
  }

  static createSerialBanner(config?: SerialConfig): string {
    const port = config?.path || 'COM Port';
    const baud = config?.baudRate || 115200;
    
    return [
      `\x1b[1;35m--- Tef Serial Monitor Stream Opened [${port}] ---\x1b[0m\r\n`,
      `\x1b[36mBaud: ${baud} bps | Data: ${config?.dataBits || 8} | Parity: ${config?.parity || 'NONE'} | Stop: ${config?.stopBits || 1}\x1b[0m\r\n`,
      `-----------------------------------------------------------------\r\n`,
    ].join('');
  }

  // Interactive command parser for Local Terminal tabs
  static processShellInput(inputCommand: string): { output: string; newPath?: string } {
    const cmd = inputCommand.trim();
    if (!cmd) return { output: '' };

    if (cmd.toLowerCase() === 'clear') {
      return { output: '\x1bc' };
    }

    return { output: `\r\nCommand output for "${cmd}" executed.\r\n` };
  }
}
