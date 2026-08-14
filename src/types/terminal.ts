export type ProtocolType = 'ssh' | 'serial' | 'local';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  authMethod: 'password' | 'privateKey' | 'agent';
  keepaliveInterval?: number;
  autoReconnect?: boolean;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1 | 1.5 | 2;
  flowControl: 'none' | 'hardware' | 'software';
  autoReconnect?: boolean;
  friendlyName?: string;
  vid?: string;
  pid?: string;
}

export interface Session {
  id: string;
  name: string;
  protocol: ProtocolType;
  group: string;
  favorite?: boolean;
  tags?: string[];
  sshConfig?: SSHConfig;
  serialConfig?: SerialConfig;
  lastConnected?: string;
}

export interface Snippet {
  id: string;
  title: string;
  command: string;
  category: string;
  description?: string;
  triggerKey?: string;
  protocol?: ProtocolType;
}

export interface TerminalTab {
  id: string;
  sessionId?: string;
  title: string;
  protocol: ProtocolType;
  status: 'connected' | 'disconnected' | 'reconnecting';
  sshConfig?: SSHConfig;
  serialConfig?: SerialConfig;
  isHexMode?: boolean;
  isTimestampMode?: boolean;
}

export interface FileItem {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  permissions?: string;
  numericChmod?: string;
  modifiedAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  tabs: TerminalTab[];
}
