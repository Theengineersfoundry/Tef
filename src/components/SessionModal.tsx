import React, { useState, useEffect } from 'react';
import { X, SquareTerminal, Cpu, Terminal, RefreshCw, Check } from 'lucide-react';
import type { ProtocolType, Session } from '../types/terminal';
import { TerminalEngine, type DeviceInfo } from '../services/terminalEngine';

function resolveProtocol(session?: Session | null, fallback?: ProtocolType): 'ssh' | 'serial' | 'local' {
  if (session) {
    if (session.protocol === 'local') return 'local';
    const hasSsh = Boolean(session.sshConfig?.host || session.sshConfig?.username);
    const hasSerial = Boolean(session.serialConfig?.path);
    if (hasSsh && !hasSerial) return 'ssh';
    if (hasSerial && !hasSsh) return 'serial';
    if (session.protocol === 'serial') return 'serial';
    return 'ssh';
  }
  if (fallback === 'serial') return 'serial';
  if (fallback === 'local') return 'local';
  return 'ssh';
}

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (session: Session) => void;
  initialProtocol?: ProtocolType;
  initialSession?: Session | null;
}

export const SessionModal: React.FC<SessionModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialProtocol,
  initialSession = null,
}) => {
  const isEditing = Boolean(initialSession);
  const [protocol, setProtocol] = useState<'ssh' | 'serial' | 'local'>(() =>
    resolveProtocol(initialSession, initialProtocol)
  );
  const [name, setName] = useState('');
  const [group, setGroup] = useState('Remote Linux');

  // Quick SSH CLI String
  const [cliInput, setCliInput] = useState('');

  // SSH Fields
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'privateKey' | 'agent'>('privateKey');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [sshAutoReconnect, setSshAutoReconnect] = useState(true);

  // Serial Fields
  const [availablePorts, setAvailablePorts] = useState<DeviceInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8>(8);
  const [parity, setParity] = useState<'none' | 'even' | 'odd'>('none');
  const [stopBits, setStopBits] = useState<1 | 1.5 | 2>(1);
  const [serialAutoReconnect, setSerialAutoReconnect] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  const defaultGroup = (p: 'ssh' | 'serial' | 'local') =>
    p === 'serial' ? 'Microcontrollers' : p === 'local' ? 'Local' : 'Remote Linux';

  const resetForm = (nextProtocol: 'ssh' | 'serial' | 'local') => {
    setProtocol(nextProtocol);
    setName(nextProtocol === 'local' ? 'Local Shell' : '');
    setGroup(defaultGroup(nextProtocol));
    setCliInput('');
    setHost('');
    setPort(22);
    setUsername('');
    setAuthMethod('privateKey');
    setPassword('');
    setPrivateKeyPath('');
    setSshAutoReconnect(true);
    setBaudRate(115200);
    setDataBits(8);
    setParity('none');
    setStopBits(1);
    setSerialAutoReconnect(true);
    setSelectedPort('');
  };

  const loadSession = (session: Session) => {
    const protocolToUse = resolveProtocol(session);
    setProtocol(protocolToUse);
    setName(session.name || '');
    setGroup(session.group || defaultGroup(protocolToUse));
    setCliInput('');

    const ssh = session.sshConfig;
    setHost(ssh?.host || '');
    setPort(ssh?.port || 22);
    setUsername(ssh?.username || '');
    setAuthMethod(ssh?.authMethod || 'privateKey');
    setPassword(ssh?.password || '');
    setPrivateKeyPath(ssh?.privateKeyPath || '');
    setSshAutoReconnect(ssh?.autoReconnect !== false);

    const serial = session.serialConfig;
    setSelectedPort(serial?.path || '');
    setBaudRate(serial?.baudRate || 115200);
    setDataBits(serial?.dataBits || 8);
    setParity(serial?.parity || 'none');
    setStopBits(serial?.stopBits || 1);
    setSerialAutoReconnect(serial?.autoReconnect !== false);
  };

  const scanPorts = async (preferredPath?: string) => {
    setIsScanning(true);
    try {
      const ports = await TerminalEngine.scanSerialPorts();
      setAvailablePorts(ports);
      if (ports.length > 0) {
        const preferred = preferredPath ? ports.find((p) => p.path === preferredPath) : undefined;
        const validPort = preferred || ports.find((p) => p.available) || ports[0];
        setSelectedPort(validPort.path);
      } else if (preferredPath) {
        setSelectedPort(preferredPath);
      } else {
        setSelectedPort('');
      }
    } catch {
      if (preferredPath) setSelectedPort(preferredPath);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    if (initialSession) {
      loadSession(initialSession);
      if (resolveProtocol(initialSession) === 'serial') {
        void scanPorts(initialSession.serialConfig?.path);
      }
      return;
    }

    resetForm(resolveProtocol(null, initialProtocol));
    if (initialProtocol === 'serial') {
      void scanPorts();
    }
  }, [isOpen, initialProtocol, initialSession?.id]);

  const handleParseCLI = (cmdStr: string) => {
    setCliInput(cmdStr);
    const parsed = TerminalEngine.parseSSHCommandLine(cmdStr);
    if (parsed) {
      if (parsed.host) setHost(parsed.host);
      if (parsed.username) setUsername(parsed.username);
      if (parsed.port) setPort(parsed.port);
      if (parsed.authMethod) setAuthMethod(parsed.authMethod);
      if (parsed.privateKeyPath) setPrivateKeyPath(parsed.privateKeyPath);
      if (!name) setName(`${parsed.username || 'SSH'}@${parsed.host || 'host'}`);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const sessionName =
      name.trim() ||
      (protocol === 'ssh'
        ? `${username}@${host}`
        : protocol === 'serial'
          ? `Serial ${selectedPort}`
          : 'Local Shell');

    const newSession: Session = {
      id: initialSession?.id || `session-${Date.now()}`,
      name: sessionName,
      protocol,
      group: group || 'Custom Connections',
      favorite: initialSession?.favorite ?? true,
      tags: initialSession?.tags,
      lastConnected:
        initialSession?.lastConnected ||
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    if (protocol === 'ssh') {
      newSession.sshConfig = {
        host,
        port,
        username,
        authMethod,
        password,
        privateKeyPath,
        autoReconnect: sshAutoReconnect,
        keepaliveInterval: 10,
      };
    } else if (protocol === 'serial') {
      const foundPort = availablePorts.find((p) => p.path === selectedPort);
      newSession.serialConfig = {
        path: selectedPort,
        friendlyName: foundPort?.friendlyName || selectedPort,
        baudRate,
        dataBits,
        parity,
        stopBits,
        flowControl: 'none',
        autoReconnect: serialAutoReconnect,
        vid: foundPort?.vid,
        pid: foundPort?.pid,
      };
    }

    onSave(newSession);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.stopPropagation();
      }}
    >
      <div
        className="modal-card session-modal max-w-lg"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="font-semibold text-[15px]" style={{ color: 'var(--text-bright)' }}>
              {isEditing ? 'Edit connection' : 'New connection'}
            </h2>
          </div>
          <button onClick={onClose} type="button" className="btn-ghost" title="Close" style={{ width: 28, height: 28, padding: 0 }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" autoComplete="off">
          <div>
            <label className="field-label">Connection type</label>
            {isEditing ? (
              <div className={`protocol-choice is-active`} style={{ width: '100%' }}>
                {protocol === 'ssh' ? (
                  <>
                    <SquareTerminal className="w-3.5 h-3.5 shrink-0" />
                    <span>SSH</span>
                  </>
                ) : protocol === 'serial' ? (
                  <>
                    <Cpu className="w-3.5 h-3.5 shrink-0" />
                    <span>Serial</span>
                  </>
                ) : (
                  <>
                    <Terminal className="w-3.5 h-3.5 shrink-0" />
                    <span>Local</span>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setProtocol('ssh');
                    setGroup('Remote Linux');
                  }}
                  className={`protocol-choice${protocol === 'ssh' ? ' is-active' : ''}`}
                >
                  <SquareTerminal className="w-3.5 h-3.5 shrink-0" />
                  <span>SSH</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProtocol('serial');
                    setGroup('Microcontrollers');
                    void scanPorts();
                  }}
                  className={`protocol-choice${protocol === 'serial' ? ' is-active' : ''}`}
                >
                  <Cpu className="w-3.5 h-3.5 shrink-0" />
                  <span>Serial</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProtocol('local');
                    setGroup('Local');
                    if (!name.trim()) setName('Local Shell');
                  }}
                  className={`protocol-choice${protocol === 'local' ? ' is-active' : ''}`}
                >
                  <Terminal className="w-3.5 h-3.5 shrink-0" />
                  <span>Local</span>
                </button>
              </div>
            )}
          </div>

          {protocol === 'ssh' && (
            <div className="ssh-cli-card">
              <label htmlFor="quickSshCli" className="ssh-cli-card-label">
                <Terminal className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span>Paste an SSH command (optional)</span>
              </label>
              <input
                id="quickSshCli"
                name="quickSshCli"
                type="text"
                placeholder='ssh -i ~/.ssh/id_rsa user@192.168.1.10'
                value={cliInput}
                onChange={(e) => handleParseCLI(e.target.value)}
                className="font-mono text-[12px]"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sessionDisplayName" className="field-label">Name</label>
              <input
                id="sessionDisplayName"
                name="sessionDisplayName"
                type="text"
                placeholder={
                  protocol === 'ssh' ? 'My server' : protocol === 'serial' ? 'ESP32 board' : 'Local Shell'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="sessionFolderCategory" className="field-label">Folder</label>
              <input
                id="sessionFolderCategory"
                name="sessionFolderCategory"
                type="text"
                placeholder="e.g. Lab devices"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>

          {protocol === 'ssh' && (
            <div className="space-y-3 pt-1" style={{ borderTop: '1px solid var(--md-sys-color-outline-variant)', paddingTop: 16 }}>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="sshHostAddress" className="field-label">Host / IP</label>
                  <input id="sshHostAddress" name="sshHostAddress" type="text" required value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" placeholder="192.168.1.10" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="sshPortNumber" className="field-label">Port</label>
                  <input id="sshPortNumber" name="sshPortNumber" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className="font-mono" autoComplete="off" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sshUsername" className="field-label">Username</label>
                  <input id="sshUsername" name="sshUsername" type="text" required placeholder="pi / root" value={username} onChange={(e) => setUsername(e.target.value)} className="font-mono" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="sshAuthMethod" className="field-label">Auth</label>
                  <select id="sshAuthMethod" name="sshAuthMethod" value={authMethod} onChange={(e) => setAuthMethod(e.target.value as any)}>
                    <option value="privateKey">Private key</option>
                    <option value="password">Password</option>
                  </select>
                </div>
              </div>

              {authMethod === 'privateKey' ? (
                <div>
                  <label htmlFor="sshKeyPath" className="field-label">Private key path</label>
                  <input id="sshKeyPath" name="sshKeyPath" type="text" value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} className="font-mono" placeholder="C:\Users\Username\.ssh\id_rsa" autoComplete="off" />
                </div>
              ) : (
                <div>
                  <label htmlFor="sshPassword" className="field-label">Password</label>
                  <input id="sshPassword" name="sshPassword" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
              )}

              <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--text)' }}>
                <input type="checkbox" id="sshAutoRec" name="sshAutoRec" checked={sshAutoReconnect} onChange={(e) => setSshAutoReconnect(e.target.checked)} />
                Enable auto-reconnect
              </label>
            </div>
          )}

          {protocol === 'serial' && (
            <div className="space-y-3 pt-1" style={{ borderTop: '1px solid var(--md-sys-color-outline-variant)', paddingTop: 16 }}>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label htmlFor="serialPortSelect" className="field-label" style={{ marginBottom: 0 }}>COM port</label>
                  <button type="button" onClick={() => void scanPorts()} className="btn-ghost" style={{ height: 28 }}>
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                    Scan
                  </button>
                </div>
                <select id="serialPortSelect" name="serialPortSelect" value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)} className="font-mono">
                  {selectedPort && !availablePorts.some((p) => p.path === selectedPort) && (
                    <option value={selectedPort}>{selectedPort} (saved)</option>
                  )}
                  {availablePorts.map((p) => (
                    <option key={p.path} value={p.path} disabled={!p.available}>{p.friendlyName}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="serialBaudSelect" className="field-label">Baud rate</label>
                  <select id="serialBaudSelect" name="serialBaudSelect" value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))} className="font-mono">
                    <option value={1200}>1200</option>
                    <option value={2400}>2400</option>
                    <option value={4800}>4800</option>
                    <option value={9600}>9600</option>
                    <option value={19200}>19200</option>
                    <option value={38400}>38400</option>
                    <option value={57600}>57600</option>
                    <option value={115200}>115200</option>
                    <option value={230400}>230400</option>
                    <option value={460800}>460800</option>
                    <option value={921600}>921600</option>
                    <option value={3000000}>3000000</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="serialParitySelect" className="field-label">Parity</label>
                  <select id="serialParitySelect" name="serialParitySelect" value={parity} onChange={(e) => setParity(e.target.value as any)} className="font-mono">
                    <option value="none">None</option>
                    <option value="even">Even</option>
                    <option value="odd">Odd</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="serialDataBitsSelect" className="field-label">Data bits</label>
                  <select id="serialDataBitsSelect" name="serialDataBitsSelect" value={dataBits} onChange={(e) => setDataBits(Number(e.target.value) as any)} className="font-mono">
                    <option value={8}>8</option>
                    <option value={7}>7</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="serialStopBitsSelect" className="field-label">Stop bits</label>
                  <select id="serialStopBitsSelect" name="serialStopBitsSelect" value={stopBits} onChange={(e) => setStopBits(Number(e.target.value) as any)} className="font-mono">
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--text)' }}>
                <input type="checkbox" id="serialAutoRec" name="serialAutoRec" checked={serialAutoReconnect} onChange={(e) => setSerialAutoReconnect(e.target.checked)} />
                Reconnect if USB is replugged
              </label>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-ide-secondary">Cancel</button>
            <button type="submit" className="btn-ide-primary">
              <Check className="w-3.5 h-3.5" />
              {isEditing ? 'Save' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
