import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { 
  Trash2, 
  Copy, 
  Clipboard, 
  Download, 
  Binary, 
  Clock, 
  Check, 
  FolderOpen,
  Send,
  Cpu,
  Power,
  Plug,
  ChevronsDown,
  FileText,
} from 'lucide-react';
import type { TerminalTab as TabType } from '../types/terminal';
import { TerminalEngine } from '../services/terminalEngine';
import { AutoSuggestEngine } from '../services/autosuggestEngine';
import { SerialManager } from '../services/serialManager';
import { TerminalBridge } from '../services/terminalBridge';
import {
  closeSession,
  isTauriRuntime,
  onSessionEvent,
  openSerialSession,
  openSshSession,
  openLocalSession,
  readClipboardText,
  resizeSession,
  saveTextFile,
  setSessionBaud,
  writeClipboardText,
  writeSession,
  type SessionEvent,
} from '../services/sessionBackend';

interface TerminalTabProps {
  tab: TabType;
  isActive: boolean;
  onUpdateTabStatus: (tabId: string, status: TabType['status'], tx?: number, rx?: number) => void;
  onOpenSFTPTab?: (tab: TabType) => void;
  suspendTerminalFocus?: boolean;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({
  tab,
  isActive,
  onUpdateTabStatus,
  onOpenSFTPTab,
  suspendTerminalFocus = false,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const inputBufferRef = useRef<string>('');
  
  const [copied, setCopied] = useState(false);
  const [isHexMode, setIsHexMode] = useState(tab.isHexMode || false);
  const [isTimestampMode, setIsTimestampMode] = useState(tab.isTimestampMode || false);
  const [isLogging, setIsLogging] = useState(false);
  const [logSize, setLogSize] = useState(0);
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const sessionLogRef = useRef('');
  const logPendingRef = useRef({ RX: '', TX: '' });
  const logIdleTimerRef = useRef<number | null>(null);
  const logNoticeTimerRef = useRef<number | null>(null);
  const isLoggingRef = useRef(false);
  isLoggingRef.current = isLogging;
  const [autoSuggestEnabled] = useState(true);

  // Serial Hardware Dynamic Controls
  const [currentBaudRate, setCurrentBaudRate] = useState<number>(tab.serialConfig?.baudRate || 115200);

  // Serial Command Bar Controls
  const [serialTxMode, setSerialTxMode] = useState<'ASCII' | 'HEX'>('ASCII');
  const [serialLineEnding, setSerialLineEnding] = useState<'CRLF' | 'LF' | 'CR' | 'NONE'>('CRLF');
  const [serialInputText, setSerialInputText] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef('');
  const serialTxModeRef = useRef(serialTxMode);
  const serialLineEndingRef = useRef(serialLineEnding);
  serialTxModeRef.current = serialTxMode;
  serialLineEndingRef.current = serialLineEnding;

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (suspendTerminalFocus) {
      const ta = xtermRef.current?.element?.querySelector('textarea');
      if (ta instanceof HTMLElement) ta.blur();
      return;
    }
    if (isActive && xtermRef.current) {
      const ta = xtermRef.current.element?.querySelector('textarea');
      if (ta instanceof HTMLElement) ta.focus({ preventScroll: true });
    }
  }, [isActive, suspendTerminalFocus]);

  // Register this tab so macros/snippets can inject into the live session
  useEffect(() => {
    const unregister = TerminalBridge.register(tab.id, (data: string) => {
      const command = data.replace(/[\r\n]+$/, '');
      if (!command) return false;

      if (tab.protocol === 'serial') {
        return sendSerialPayloadRef.current(command);
      }

      // SSH / local live sockets (Tauri)
      if (isTauriRuntime()) {
        sendSessionData({ data: `${command}\n` });
        return true;
      }

      // SSH / other live sockets (browser Node backend)
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'DATA', data: `${command}\n` }));
        return true;
      }

      // Local simulated shell (browser fallback)
      if (tab.protocol === 'local' && xtermRef.current) {
        const term = xtermRef.current;
        term.write(command + '\r\n');
        if (command.trim().length > 0) {
          AutoSuggestEngine.addHistory(command);
          const res = TerminalEngine.processShellInput(command);
          if (res.output === '\x1bc') wipeTerminal(term);
          else term.write(res.output);
        }
        term.write(`\x1b[36mPS C:\\Users\\Developer> \x1b[0m`);
        return true;
      }

      return false;
    });
    return unregister;
  }, [tab.id, tab.protocol]);
  const ghostSuggestionRef = useRef<string | null>(null);
  const suggestionBadgeRef = useRef<HTMLSpanElement | null>(null);
  const tauriUnsubRef = useRef<(() => void) | null>(null);
  const handleTerminalKeyRef = useRef<
    (domEvent: KeyboardEvent, term: Terminal, isLocal?: boolean) => boolean
  >(() => true);
  const acceptInlineSuggestionRef = useRef<(term: Terminal, isLocal: boolean) => boolean>(() => false);
  const suppressSuggestKeyRef = useRef(false);
  const retryTimerRef = useRef<any>(null);
  const sendSerialPayloadRef = useRef<(text: string) => boolean>(() => false);
  /** True after user clicks Disconnect — blocks auto-reconnect until they Connect again */
  const suppressAutoReconnectRef = useRef(false);
  /** Only auto-reconnect after we had a live serial session (not on first failed open) */
  const hadSerialConnectionRef = useRef(false);
  const autoReconnectAttemptRef = useRef<number>(0);
  const autoReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped on manual Connect/Disconnect so stale auto-reconnect callbacks are ignored */
  const serialConnectEpochRef = useRef(0);
  /** Bumped per local-shell connect attempt so stale DISCONNECTED events cannot overwrite status */
  const localConnectEpochRef = useRef(0);
  const connectSerialWebSocketRef = useRef<(term: Terminal, attempt?: number, silent?: boolean) => void>(() => {});
  /** Wait for Clear-Host to finish before positioning its new prompt. */
  const suppressHomeClearRef = useRef(false);
  /** Timestamp until which auto-scroll is paused (after clear). */
  const suppressScrollUntilRef = useRef(0);
  /** Preserve the existing xterm screen while a replacement local PTY starts. */
  const preserveLocalScreenRef = useRef(false);
  const localStartupDataRef = useRef('');
  const localStartupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollRef = useRef(false);
  const pointerDownRef = useRef(false);

  const stayAtBottomIfPinned = (term: Terminal) => {
    if (!autoScrollRef.current) return;
    if (pointerDownRef.current) return;
    if (Date.now() < suppressScrollUntilRef.current) return;
    programmaticScrollRef.current = true;
    term.scrollToBottom();
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  };

  const flushLocalStartupData = (term: Terminal) => {
    if (localStartupTimerRef.current) {
      clearTimeout(localStartupTimerRef.current);
      localStartupTimerRef.current = null;
    }
    const startupData = localStartupDataRef.current;
    localStartupDataRef.current = '';
    preserveLocalScreenRef.current = false;
    if (!startupData) return;

    // A fresh ConPTY can replay screen initialization for its own blank screen.
    // Do not let those sequences clear/home the xterm buffer retained by this tab.
    const preservedData = startupData
      .replace(/\x1bc/g, '')
      .replace(/\x1b\[[?0-9;]*[HJf]/g, '');
    term.write(preservedData);
    stayAtBottomIfPinned(term);
  };

  const writeIncomingTerminalData = (term: Terminal, raw: string) => {
    if (preserveLocalScreenRef.current) {
      localStartupDataRef.current += raw;
      const plainStartup = localStartupDataRef.current
        .replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '')
        .replace(/\x1b./g, '');
      const hasShellPrompt =
        /(?:PS\s+[^\r\n>]+>|[A-Za-z]:\\[^\r\n>]*>)\s*$/.test(plainStartup);

      if (hasShellPrompt || localStartupDataRef.current.length >= 65536) {
        flushLocalStartupData(term);
      } else if (!localStartupTimerRef.current) {
        localStartupTimerRef.current = setTimeout(() => flushLocalStartupData(term), 1500);
      }
      return;
    }

    if (suppressHomeClearRef.current) {
      // After a clear: let Clear-Host escape sequences through (PTY cursor reset),
      // but block auto-scroll. Once the prompt lands, scroll to top so it appears
      // at the top of the blank screen.
      const stripped = raw.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').replace(/\x1b./g, '');
      const hasPromptText = /PS\s+\S+>\s*$/.test(stripped);
      term.write(raw);
      if (hasPromptText) {
        const wasClear = suppressScrollUntilRef.current > 0;
        suppressHomeClearRef.current = false;
        suppressScrollUntilRef.current = 0;
        if (wasClear) {
          term.scrollToTop();
        }
      }
      return;
    }
    term.write(raw);
    stayAtBottomIfPinned(term);
  };

  const hideInlineSuggestion = () => {
    ghostSuggestionRef.current = null;
    const el = suggestionBadgeRef.current;
    if (el) {
      el.style.display = 'none';
      el.textContent = '';
    }
  };

  const getTermCellMetrics = (term: Terminal) => {
    const screen = term.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return null;

    const core = term as unknown as {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } };
    };
    const cell = core._core?._renderService?.dimensions?.css?.cell;
    if (cell && cell.width > 0 && cell.height > 0) {
      return { screen, cellWidth: cell.width, cellHeight: cell.height };
    }

    const rect = screen.getBoundingClientRect();
    if (term.cols <= 0 || term.rows <= 0 || rect.width <= 0 || rect.height <= 0) return null;
    return {
      screen,
      cellWidth: rect.width / term.cols,
      cellHeight: rect.height / term.rows,
    };
  };

  /** Fit xterm to its host and trim rows/cols when metrics exceed the viewport. */
  const fitTerminalToHost = (term: Terminal, fitAddon: FitAddon, host: HTMLElement | null) => {
    if (!host || host.clientWidth < 24 || host.clientHeight < 24) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const xtermEl = term.element;
    const metrics = getTermCellMetrics(term);
    if (!xtermEl || !metrics) return;

    const availHeight = xtermEl.clientHeight;
    if (availHeight <= 0) return;

    // Leave a little slack so the last row is not clipped on high-DPI displays.
    let rows = term.rows;
    while (rows > 2 && rows * metrics.cellHeight > availHeight - 1) {
      rows -= 1;
    }

    if (rows !== term.rows) {
      term.resize(rows, term.cols);
    }
  };

  const notifyTerminalResize = (term: Terminal) => {
    if (isTauriRuntime()) {
      void resizeSession(tab.id, term.rows, term.cols);
    } else if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'RESIZE',
        rows: term.rows,
        cols: term.cols,
      }));
    }
  };

  /** Inline ghost text aligned to the xterm cell grid (after cursor). */
  const updateSuggestionOverlay = (prefix: string) => {
    if (tab.protocol === 'serial' || !autoSuggestEnabled) {
      hideInlineSuggestion();
      return;
    }

    const term = xtermRef.current;
    const badge = suggestionBadgeRef.current;
    if (!term || !badge || term.buffer.active.type === 'alternate') {
      hideInlineSuggestion();
      return;
    }

    const host = badge.parentElement;
    if (!host) {
      hideInlineSuggestion();
      return;
    }

    const sug = AutoSuggestEngine.getSuggestion(prefix);
    if (!sug || !prefix.trim()) {
      hideInlineSuggestion();
      return;
    }

    const metrics = getTermCellMetrics(term);
    if (!metrics) {
      hideInlineSuggestion();
      return;
    }

    const { screen, cellWidth, cellHeight } = metrics;
    const cursorX = term.buffer.active.cursorX;
    const cursorY = term.buffer.active.cursorY;
    const maxChars = Math.max(0, term.cols - cursorX);
    const display = sug.slice(0, maxChars);
    if (!display) {
      hideInlineSuggestion();
      return;
    }

    ghostSuggestionRef.current = sug;

    const hostRect = host.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const left = screenRect.left - hostRect.left + cursorX * cellWidth;
    const top = screenRect.top - hostRect.top + cursorY * cellHeight;

    badge.textContent = display;
    badge.style.display = 'block';
    badge.style.left = `${Math.round(left)}px`;
    badge.style.top = `${Math.round(top)}px`;
    badge.style.height = `${cellHeight}px`;
    badge.style.lineHeight = `${cellHeight}px`;
    badge.style.fontSize = `${term.options.fontSize || 12}px`;
    badge.style.fontFamily = String(term.options.fontFamily || 'monospace');
    badge.style.letterSpacing = '0';
  };

  /** Refresh after paint so cursorX reflects remote echo. */
  const scheduleSuggestionUpdate = (prefix: string) => {
    requestAnimationFrame(() => {
      updateSuggestionOverlay(prefix);
      requestAnimationFrame(() => updateSuggestionOverlay(prefix));
    });
  };

  const isHexModeRef = useRef(isHexMode);
  const hexPendingRef = useRef<number[]>([]);
  const hexIdleTimerRef = useRef<number | null>(null);
  useEffect(() => {
    isHexModeRef.current = isHexMode;
  }, [isHexMode]);

  const isTimestampModeRef = useRef(isTimestampMode);
  useEffect(() => {
    isTimestampModeRef.current = isTimestampMode;
  }, [isTimestampMode]);

  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(autoScroll);
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  const takeHexRows = (flushRemainder: boolean): string => {
    const buf = hexPendingRef.current;
    const complete = Math.floor(buf.length / 16) * 16;
    const take = flushRemainder ? buf.length : complete;
    if (take === 0) return '';
    const rows = SerialManager.formatHexDumpFromBytes(buf.slice(0, take));
    hexPendingRef.current = buf.slice(take);
    return rows;
  };

  const scheduleHexIdleFlush = () => {
    if (hexIdleTimerRef.current) window.clearTimeout(hexIdleTimerRef.current);
    hexIdleTimerRef.current = window.setTimeout(() => {
      hexIdleTimerRef.current = null;
      const leftover = takeHexRows(true);
      if (leftover) xtermRef.current?.write(leftover);
    }, 40);
  };

  const flushPendingHexView = () => {
    if (hexIdleTimerRef.current) {
      window.clearTimeout(hexIdleTimerRef.current);
      hexIdleTimerRef.current = null;
    }
    const leftover = takeHexRows(true);
    if (leftover) xtermRef.current?.write(leftover);
  };

  // ASCII concatenates in xterm. Hex must wait for a full 16-byte row or a short idle
  // so USB packet splits (O then n) do not become two dump lines.
  const formatIncomingSerialData = (rawText: string): string => {
    if (isHexModeRef.current) {
      hexPendingRef.current.push(...SerialManager.textToBytes(rawText));
      const rows = takeHexRows(false);
      if (hexPendingRef.current.length > 0) scheduleHexIdleFlush();
      else if (hexIdleTimerRef.current) {
        window.clearTimeout(hexIdleTimerRef.current);
        hexIdleTimerRef.current = null;
      }
      return rows;
    }

    let formatted = rawText.replace(/\r?\n/g, '\r\n');

    if (isTimestampModeRef.current) {
      const timeStr = `\x1b[90m[${new Date().toLocaleTimeString([], { hour12: false })}.${Math.floor(Date.now() % 1000).toString().padStart(3, '0')}]\x1b[0m `;
      formatted = formatted.replace(/\r\n/g, `\r\n${timeStr}`);
    }

    return formatted;
  };

  const stripAnsi = (text: string) =>
    text
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b./g, '');

  const showLogNotice = (message: string) => {
    setLogNotice(message);
    if (logNoticeTimerRef.current) window.clearTimeout(logNoticeTimerRef.current);
    logNoticeTimerRef.current = window.setTimeout(() => {
      logNoticeTimerRef.current = null;
      setLogNotice(null);
    }, 2800);
  };

  const buildLogHeader = () =>
    `--- SSHark Session Log ---\n` +
    `Session: ${tab.title}\n` +
    `Protocol: ${tab.protocol}\n` +
    `Started: ${new Date().toISOString()}\n` +
    `---\n`;

  const writeLogLine = (direction: 'TX' | 'RX' | '', line: string) => {
    const stamp = new Date().toISOString().slice(11, 23);
    const prefix = direction ? `[${stamp}] ${direction} ` : '';
    sessionLogRef.current += `${prefix}${line}\n`;
    const maxChars = 2_000_000;
    if (sessionLogRef.current.length > maxChars) {
      sessionLogRef.current = sessionLogRef.current.slice(-maxChars);
    }
    setLogSize(sessionLogRef.current.length);
  };

  const flushLogRemainder = () => {
    (['RX', 'TX'] as const).forEach((dir) => {
      const leftover = logPendingRef.current[dir];
      if (!leftover) return;
      logPendingRef.current[dir] = '';
      writeLogLine(dir, leftover);
    });
  };

  const appendSessionLog = (chunk: string, direction?: 'TX' | 'RX') => {
    if (!isLoggingRef.current || !chunk) return;
    const plain = stripAnsi(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!plain) return;

    const dir = direction ?? 'RX';
    let buf = logPendingRef.current[dir] + plain;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      writeLogLine(dir, buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
    logPendingRef.current[dir] = buf;

    if (logIdleTimerRef.current) window.clearTimeout(logIdleTimerRef.current);
    if (buf) {
      logIdleTimerRef.current = window.setTimeout(() => {
        logIdleTimerRef.current = null;
        flushLogRemainder();
      }, 80);
    } else {
      logIdleTimerRef.current = null;
    }
  };

  const closeSerialSocket = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (tauriUnsubRef.current) {
      tauriUnsubRef.current();
      tauriUnsubRef.current = null;
    }
    if (isTauriRuntime()) {
      void closeSession(tab.id);
    }
    const ws = socketRef.current;
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch {}
    socketRef.current = null;
  };

  const sendSessionData = (payload: { data?: string; bytes?: number[] }) => {
    if (isTauriRuntime()) {
      void writeSession(tab.id, payload);
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'DATA', ...payload }));
    }
  };

  const clearAutoReconnectTimer = () => {
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
  };

  // Disconnect active port/session safely (manual — no auto-reconnect)
  const handleDisconnect = () => {
    serialConnectEpochRef.current += 1;
    localConnectEpochRef.current += 1;
    suppressAutoReconnectRef.current = true;
    hadSerialConnectionRef.current = false;
    autoReconnectAttemptRef.current = 0;
    clearAutoReconnectTimer();
    closeSerialSocket();
    onUpdateTabStatus(tab.id, 'disconnected');
    if (xtermRef.current) {
      xtermRef.current.write('\r\n\x1b[31mDisconnected.\x1b[0m\r\n');
      stayAtBottomIfPinned(xtermRef.current);
    }
  };

  const canSerialAutoReconnect = () =>
    tab.protocol === 'serial' &&
    !suppressAutoReconnectRef.current &&
    hadSerialConnectionRef.current &&
    tab.serialConfig?.autoReconnect !== false;

  const scheduleSerialAutoReconnect = (_term: Terminal, _reason: string) => {
    if (!canSerialAutoReconnect()) {
      onUpdateTabStatus(tab.id, 'disconnected');
      return;
    }

    clearAutoReconnectTimer();
    // Drop the idle socket while waiting — next attempt opens a fresh one
    closeSerialSocket();

    autoReconnectAttemptRef.current += 1;
    const attempt = autoReconnectAttemptRef.current;
    const epoch = serialConnectEpochRef.current;
    const delay = Math.min(10_000, Math.round(1000 * Math.pow(1.6, Math.min(attempt - 1, 7))));

    onUpdateTabStatus(tab.id, 'reconnecting');

    autoReconnectTimerRef.current = setTimeout(() => {
      if (epoch !== serialConnectEpochRef.current) return;
      if (!canSerialAutoReconnect() || !xtermRef.current) {
        onUpdateTabStatus(tab.id, 'disconnected');
        return;
      }
      connectSerialWebSocketRef.current(xtermRef.current, 1, true);
    }, delay);
  };

  // Change Active Serial Hardware Baud Rate On-the-Fly
  const handleBaudRateChange = (newBaud: number) => {
    setCurrentBaudRate(newBaud);
    if (isTauriRuntime()) {
      void setSessionBaud(tab.id, newBaud).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        xtermRef.current?.write(`\r\n\x1b[33m${message}\x1b[0m\r\n`);
      });
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'CHANGE_BAUD',
        baudRate: newBaud,
      }));
    }
  };

  // Send Serial UART Command (ASCII + line ending, or raw HEX bytes)
  const sendSerialPayload = (textToSend: string): boolean => {
    const canSend =
      isTauriRuntime() || socketRef.current?.readyState === WebSocket.OPEN;
    if (!textToSend || !canSend) return false;

    const portLabel = tab.serialConfig?.path || 'COM';

    if (serialTxModeRef.current === 'HEX') {
      const bytes = SerialManager.parseHexInput(textToSend);
      if (!bytes) {
        xtermRef.current?.write(
          `\r\n\x1b[1;31m[TX error] Invalid hex — use bytes like 41 54 0D 0A\x1b[0m\r\n`
        );
        return false;
      }
      sendSessionData({ bytes });
      const hexPreview = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      appendSessionLog(`${hexPreview}\n`, 'TX');
      xtermRef.current?.write(`\r\n\x1b[1;36m[TX HEX -> ${portLabel}] ${hexPreview}\x1b[0m\r\n`);
      return true;
    }

    const ending = serialLineEndingRef.current;
    const finalPayload = SerialManager.formatLineEnding(textToSend, ending);
    sendSessionData({ data: finalPayload });
    appendSessionLog(`${textToSend}\n`, 'TX');
    xtermRef.current?.write(
      `\r\n\x1b[1;36m[TX ${ending} -> ${portLabel}] ${textToSend}\x1b[0m\r\n`
    );
    return true;
  };
  sendSerialPayloadRef.current = sendSerialPayload;

  const handleSendSerialCommand = (overrideText?: string) => {
    const textToSend = overrideText !== undefined ? overrideText : serialInputText;
    if (!textToSend && overrideText === undefined) return;
    if (sendSerialPayload(textToSend)) {
      if (overrideText === undefined) setSerialInputText('');
    }
  };

  const connectSerialWebSocket = (term: Terminal, attempt: number = 1, silent: boolean = false) => {
    closeSerialSocket();

    const comPath = tab.serialConfig?.path || 'COM Port';
    const epoch = serialConnectEpochRef.current;
    const quiet = silent;

    // ── Tauri desktop path (Rust serial backend) ──
    if (isTauriRuntime()) {
      tauriUnsubRef.current = onSessionEvent((msg: SessionEvent) => {
        if (msg.sessionId !== tab.id) return;
        if (epoch !== serialConnectEpochRef.current) return;
        if (msg.type === 'CONNECTED') {
          const wasAutoReconnect = quiet || autoReconnectAttemptRef.current > 0;
          clearAutoReconnectTimer();
          autoReconnectAttemptRef.current = 0;
          hadSerialConnectionRef.current = true;
          suppressAutoReconnectRef.current = false;
          onUpdateTabStatus(tab.id, 'connected');
          if (wasAutoReconnect) {
            term.write(`\r\n\x1b[32mReconnected to ${comPath}\x1b[0m\r\n`);
          }
          stayAtBottomIfPinned(term);
        } else if (msg.type === 'BAUD_CHANGED') {
          if (typeof msg.baudRate === 'number' && msg.baudRate > 0) {
            setCurrentBaudRate(msg.baudRate);
          }
          if (msg.message) term.write(`\r\n\x1b[33m${msg.message}\x1b[0m\r\n`);
        } else if (msg.type === 'DATA' && msg.data != null) {
          const cleanOutput = formatIncomingSerialData(msg.data);
          appendSessionLog(msg.data, 'RX');
          writeIncomingTerminalData(term, cleanOutput);
        } else if (msg.type === 'ERROR') {
          if (canSerialAutoReconnect()) {
            scheduleSerialAutoReconnect(term, 'Open failed / port unavailable');
          } else {
            if (msg.error) term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
          }
        } else if (msg.type === 'DISCONNECTED') {
          if (canSerialAutoReconnect()) {
            if (autoReconnectAttemptRef.current === 0) {
              term.write(`\r\n\x1b[33m${comPath} disconnected\x1b[0m\r\n`);
            }
            scheduleSerialAutoReconnect(term, 'Port disconnected or removed');
          } else {
            term.write(`\r\n\x1b[33m${comPath} closed.\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
          }
        }
      });

      void (async () => {
        try {
          await closeSession(tab.id);
          if (epoch !== serialConnectEpochRef.current) return;
          await openSerialSession(tab.id, {
            path: comPath,
            baudRate: currentBaudRate,
            dataBits: tab.serialConfig?.dataBits,
            parity: tab.serialConfig?.parity,
            stopBits: tab.serialConfig?.stopBits,
          });
        } catch (err) {
          if (epoch !== serialConnectEpochRef.current) return;
          const message = err instanceof Error ? err.message : String(err);
          if (canSerialAutoReconnect()) {
            scheduleSerialAutoReconnect(term, 'Open failed / port unavailable');
          } else {
            term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
          }
        }
      })();
      return;
    }

    const ws = new WebSocket('ws://localhost:3001');
    socketRef.current = ws;

    ws.onopen = () => {
      if (epoch !== serialConnectEpochRef.current) return;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      ws.send(JSON.stringify({
        type: 'INIT_SERIAL',
        config: {
          ...tab.serialConfig,
          path: comPath,
          baudRate: currentBaudRate,
        },
      }));
    };

    ws.onmessage = (event) => {
      if (epoch !== serialConnectEpochRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'CONNECTED') {
          const wasAutoReconnect = quiet || autoReconnectAttemptRef.current > 0;
          clearAutoReconnectTimer();
          autoReconnectAttemptRef.current = 0;
          hadSerialConnectionRef.current = true;
          suppressAutoReconnectRef.current = false;
          onUpdateTabStatus(tab.id, 'connected');
          if (wasAutoReconnect) {
            term.write(`\r\n\x1b[32mReconnected to ${comPath}\x1b[0m\r\n`);
          }
          stayAtBottomIfPinned(term);
        } else if (msg.type === 'BAUD_CHANGED') {
          if (typeof msg.baudRate === 'number' && msg.baudRate > 0) {
            setCurrentBaudRate(msg.baudRate);
          }
          if (msg.message) term.write(`\r\n\x1b[33m${msg.message}\x1b[0m\r\n`);
        } else if (msg.type === 'DATA') {
          const cleanOutput = formatIncomingSerialData(msg.data);
          appendSessionLog(typeof msg.data === 'string' ? msg.data : String(msg.data), 'RX');
          writeIncomingTerminalData(term, cleanOutput);
        } else if (msg.type === 'ERROR') {
          if (canSerialAutoReconnect()) {
            scheduleSerialAutoReconnect(term, 'Open failed / port unavailable');
          } else {
            if (msg.error) term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
          }
        } else if (msg.type === 'DISCONNECTED') {
          if (canSerialAutoReconnect()) {
            if (autoReconnectAttemptRef.current === 0) {
              term.write(`\r\n\x1b[33m${comPath} disconnected\x1b[0m\r\n`);
            }
            scheduleSerialAutoReconnect(term, 'Port disconnected or removed');
          } else {
            term.write(`\r\n\x1b[33m${comPath} closed.\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
          }
        }
      } catch (parseErr) {
        if (typeof event.data === 'string' && !event.data.startsWith('{')) {
          term.write(formatIncomingSerialData(event.data));
        } else {
          /* ignore malformed WS frames */
        }
      }
    };

    ws.onerror = () => {
      if (epoch !== serialConnectEpochRef.current) return;
      if (attempt <= 3) {
        retryTimerRef.current = setTimeout(() => {
          if (epoch !== serialConnectEpochRef.current) return;
          connectSerialWebSocket(term, attempt + 1, quiet);
        }, 1500);
      } else if (canSerialAutoReconnect()) {
        scheduleSerialAutoReconnect(term, 'Backend connection lost');
      } else {
        term.write(`\r\n\x1b[31mCould not connect. Click Connect to retry.\x1b[0m\r\n`);
        onUpdateTabStatus(tab.id, 'disconnected');
      }
    };

    ws.onclose = () => {
      if (socketRef.current === ws) socketRef.current = null;
      if (epoch !== serialConnectEpochRef.current) return;
      if (canSerialAutoReconnect()) {
        scheduleSerialAutoReconnect(term, 'Connection closed');
      }
    };
  };
  connectSerialWebSocketRef.current = connectSerialWebSocket;

  const connectSSHWebSocket = (term: Terminal, attempt: number = 1) => {
    if (socketRef.current) socketRef.current.close();
    if (tauriUnsubRef.current) {
      tauriUnsubRef.current();
      tauriUnsubRef.current = null;
    }
    if (isTauriRuntime()) {
      void closeSession(tab.id);
    }

    suppressHomeClearRef.current = true;

    if (!isTauriRuntime()) {
      term.write(
        `\x1b[36mConnecting to ${tab.sshConfig?.username}@${tab.sshConfig?.host}:${tab.sshConfig?.port}…\x1b[0m\r\n`
      );
    }

    if (isTauriRuntime()) {
      tauriUnsubRef.current = onSessionEvent((msg: SessionEvent) => {
        if (msg.sessionId !== tab.id) return;
          if (msg.type === 'STATUS' && msg.message) {
            term.write(`\x1b[33m${msg.message}\x1b[0m\r\n`);
            stayAtBottomIfPinned(term);
          } else if (msg.type === 'CONNECTED') {
          onUpdateTabStatus(tab.id, 'connected');
          stayAtBottomIfPinned(term);
          setTimeout(() => term.focus(), 100);
        } else if (msg.type === 'DATA' && msg.data != null) {
          appendSessionLog(msg.data, 'RX');
          writeIncomingTerminalData(term, msg.data);
          try {
            AutoSuggestEngine.indexRemoteOutput(msg.data);
          } catch {}
          requestAnimationFrame(() => scheduleSuggestionUpdate(inputBufferRef.current));
        } else if (msg.type === 'ERROR') {
          term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
          onUpdateTabStatus(tab.id, 'disconnected');
          stayAtBottomIfPinned(term);
        } else if (msg.type === 'DISCONNECTED') {
          term.write(`\r\n\x1b[33mDisconnected.\x1b[0m\r\n`);
          onUpdateTabStatus(tab.id, 'disconnected');
          stayAtBottomIfPinned(term);
        }
      });

      void openSshSession(tab.id, {
        host: tab.sshConfig?.host || '',
        port: tab.sshConfig?.port,
        username: tab.sshConfig?.username || '',
        password: tab.sshConfig?.password,
        privateKeyPath: tab.sshConfig?.privateKeyPath,
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
        onUpdateTabStatus(tab.id, 'disconnected');
      });
      return;
    }

    const ws = new WebSocket('ws://localhost:3001');
    socketRef.current = ws;

    ws.onopen = () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      ws.send(JSON.stringify({
        type: 'INIT_SSH',
        config: tab.sshConfig,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'STATUS') {
          term.write(`\x1b[33m${msg.message}\x1b[0m\r\n`);
        } else if (msg.type === 'CONNECTED') {
          onUpdateTabStatus(tab.id, 'connected');
          stayAtBottomIfPinned(term);
          setTimeout(() => term.focus(), 100);
        } else if (msg.type === 'DATA') {
          appendSessionLog(msg.data, 'RX');
          writeIncomingTerminalData(term, msg.data);
          try {
            AutoSuggestEngine.indexRemoteOutput(msg.data);
          } catch {}
          requestAnimationFrame(() => {
            scheduleSuggestionUpdate(inputBufferRef.current);
          });
        } else if (msg.type === 'ERROR') {
          term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
          onUpdateTabStatus(tab.id, 'disconnected');
          stayAtBottomIfPinned(term);
        } else if (msg.type === 'DISCONNECTED') {
          term.write(`\r\n\x1b[33mDisconnected.\x1b[0m\r\n`);
          onUpdateTabStatus(tab.id, 'disconnected');
          stayAtBottomIfPinned(term);
        }
      } catch (parseErr) {
        if (typeof event.data === 'string' && !event.data.startsWith('{')) {
          term.write(event.data);
        } else {
          /* ignore malformed WS frames */
        }
      }
    };

    ws.onerror = () => {
      if (attempt <= 3) {
        retryTimerRef.current = setTimeout(() => connectSSHWebSocket(term, attempt + 1), 1500);
      } else {
        term.write(`\r\n\x1b[31mCould not connect. Click Reconnect to retry.\x1b[0m\r\n`);
        onUpdateTabStatus(tab.id, 'disconnected');
      }
    };
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'Roboto Mono', 'Consolas', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: '#0e0e11',
        foreground: '#e5e1e6',
        cursor: '#4fd8eb',
        selectionBackground: '#004f58',
        black: '#131316',
        red: '#ffb4ab',
        green: '#92d5a4',
        yellow: '#ecc078',
        blue: '#4fd8eb',
        magenta: '#c4c0ff',
        cyan: '#7ae5f2',
        white: '#e5e1e6',
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitTerminalToHost(term, fitAddon, terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Copy/paste + Tab/→ accept suggestion (via ref so handler stays fresh)
    term.attachCustomKeyEventHandler((domEvent) =>
      handleTerminalKeyRef.current(domEvent, term, tab.protocol === 'local')
    );

    // Capture Tab before the browser moves focus out of the terminal
    const hostEl = terminalRef.current?.parentElement;
    const onTabCapture = (ev: KeyboardEvent) => {
      if (
        (ev.key === 'Tab' || ev.code === 'Tab') &&
        ghostSuggestionRef.current &&
        xtermRef.current
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        acceptInlineSuggestionRef.current(xtermRef.current, tab.protocol === 'local');
      }
    };
    hostEl?.addEventListener('keydown', onTabCapture, true);

    const viewportEl = term.element?.querySelector('.xterm-viewport') as HTMLElement | null;
    const onPointerDown = () => { pointerDownRef.current = true; };
    const onPointerUp = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    viewportEl?.addEventListener('scroll', () => {}, { passive: true }); // kept for cleanup symmetry

    if (tab.protocol === 'serial') {
      connectSerialWebSocket(term, 1);

      term.onData((data) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'DATA', data }));
        } else if (isTauriRuntime()) {
          sendSessionData({ data });
        }
      });
    } else if (tab.protocol === 'ssh' && tab.sshConfig) {
      connectSSHWebSocket(term, 1);

      term.onData((data) => {
        if (
          suppressSuggestKeyRef.current &&
          (data === '\t' || data === '\x1b[C' || data === '\x1bOC')
        ) {
          return;
        }

        if (data === '\r') {
          if (inputBufferRef.current.trim()) {
            AutoSuggestEngine.addHistory(inputBufferRef.current);
          }
          inputBufferRef.current = '';
          hideInlineSuggestion();
        } else if (data === '\u007F') {
          if (inputBufferRef.current.length > 0) {
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          }
          scheduleSuggestionUpdate(inputBufferRef.current);
        } else if (data.length === 1 && data >= ' ') {
          inputBufferRef.current += data;
          scheduleSuggestionUpdate(inputBufferRef.current);
        }

        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'DATA', data }));
        } else if (isTauriRuntime()) {
          sendSessionData({ data });
        }
      });
    } else if (tab.protocol === 'local' && isTauriRuntime()) {
      connectLocalShellRef.current(term);

      term.onData((data) => {
        if (
          suppressSuggestKeyRef.current &&
          (data === '\t' || data === '\x1b[C' || data === '\x1bOC')
        ) {
          return;
        }

        if (data === '\r') {
          if (inputBufferRef.current.trim()) {
            AutoSuggestEngine.addHistory(inputBufferRef.current);
          }
          inputBufferRef.current = '';
          hideInlineSuggestion();
        } else if (data === '\u007F') {
          if (inputBufferRef.current.length > 0) {
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          }
          scheduleSuggestionUpdate(inputBufferRef.current);
        } else if (data.length === 1 && data >= ' ') {
          inputBufferRef.current += data;
          scheduleSuggestionUpdate(inputBufferRef.current);
        }

        sendSessionData({ data });
      });
    } else {
      term.write(`\x1b[1;32mLocal Terminal Shell Initialized [PowerShell Core]\x1b[0m\r\n\x1b[36mPS C:\\Users\\Developer> \x1b[0m`);

      term.onData((data) => {
        if (
          suppressSuggestKeyRef.current &&
          (data === '\t' || data === '\x1b[C' || data === '\x1bOC')
        ) {
          return;
        }

        if (
          ghostSuggestionRef.current &&
          (data === '\t' || data === '\x1b[C' || data === '\x1bOC')
        ) {
          return;
        }

        if (data === '\r') {
          const command = inputBufferRef.current;
          inputBufferRef.current = '';
          term.write('\r\n');

          if (command.trim().length > 0) {
            AutoSuggestEngine.addHistory(command);
            const res = TerminalEngine.processShellInput(command);
            if (res.output === '\x1bc') {
              wipeTerminal(term);
            } else {
              term.write(res.output);
            }
          }
          term.write(`\x1b[36mPS C:\\Users\\Developer> \x1b[0m`);
          hideInlineSuggestion();
        } else if (data === '\u007F') {
          if (inputBufferRef.current.length > 0) {
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
            term.write('\b \b');
          }
          scheduleSuggestionUpdate(inputBufferRef.current);
        } else {
          inputBufferRef.current += data;
          term.write(data);
          scheduleSuggestionUpdate(inputBufferRef.current);
        }
      });
    }

    const fitAndNotify = () => {
      fitTerminalToHost(term, fitAddon, terminalRef.current);
      notifyTerminalResize(term);
    };

    window.addEventListener('resize', fitAndNotify);

    const viewportHost = terminalRef.current?.parentElement;
    const resizeObserver =
      viewportHost && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            requestAnimationFrame(fitAndNotify);
          })
        : null;
    if (viewportHost && resizeObserver) resizeObserver.observe(viewportHost);

    const scheduleInitialFit = () => {
      requestAnimationFrame(fitAndNotify);
      setTimeout(fitAndNotify, 80);
      setTimeout(fitAndNotify, 250);
      setTimeout(fitAndNotify, 600);
    };
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(scheduleInitialFit);
    } else {
      scheduleInitialFit();
    }

    return () => {
      window.removeEventListener('resize', fitAndNotify);
      resizeObserver?.disconnect();
      hostEl?.removeEventListener('keydown', onTabCapture, true);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      pointerDownRef.current = false;
      hideInlineSuggestion();
      serialConnectEpochRef.current += 1;
      localConnectEpochRef.current += 1;
      suppressAutoReconnectRef.current = true;
      hadSerialConnectionRef.current = false;
      if (autoReconnectTimerRef.current) clearTimeout(autoReconnectTimerRef.current);
      if (localStartupTimerRef.current) clearTimeout(localStartupTimerRef.current);
      closeSerialSocket();
      term.dispose();
    };
  }, [tab.id]);

  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !xtermRef.current) return;
    const term = xtermRef.current;
    const beforeRows = term.rows;
    const beforeCols = term.cols;
    fitTerminalToHost(term, fitAddonRef.current, terminalRef.current);
    if (term.rows !== beforeRows || term.cols !== beforeCols) {
      notifyTerminalResize(term);
    }
  }, [isActive, tab.id]);

  const wipeTerminal = (term: Terminal) => {
    const scrollback = term.options.scrollback ?? 10000;
    term.options.scrollback = 0;
    term.reset();
    term.clear();
    term.options.scrollback = scrollback;
    // Cursor at top-left, no scroll jump.
    term.write('\x1b[H');
  };

  const handleClear = () => {
    const term = xtermRef.current;
    if (!term) return;
    preserveLocalScreenRef.current = false;
    localStartupDataRef.current = '';
    if (localStartupTimerRef.current) {
      clearTimeout(localStartupTimerRef.current);
      localStartupTimerRef.current = null;
    }
    if (hexIdleTimerRef.current) {
      window.clearTimeout(hexIdleTimerRef.current);
      hexIdleTimerRef.current = null;
    }
    hexPendingRef.current = [];
    wipeTerminal(term);

    if (tab.protocol === 'local' && isTauriRuntime()) {
      // Let Clear-Host do the PTY reset so the cursor is in the right place.
      // We wipe the xterm display immediately, then let the PTY response land and scroll to top.
      suppressHomeClearRef.current = true;
      suppressScrollUntilRef.current = Date.now() + 2000;
      sendSessionData({ data: 'Clear-Host\r' });
      return;
    }
    if (tab.protocol === 'ssh' && isTauriRuntime()) {
      sendSessionData({ data: '\r' });
      return;
    }
    if (tab.protocol === 'local') {
      term.write(`\x1b[36mPS C:\\Users\\Developer> \x1b[0m`);
    }
  };

  const connectLocalShell = (term: Terminal) => {
    if (!isTauriRuntime()) return;

    const epoch = ++localConnectEpochRef.current;
    if (localStartupTimerRef.current) {
      clearTimeout(localStartupTimerRef.current);
      localStartupTimerRef.current = null;
    }
    localStartupDataRef.current = '';
    preserveLocalScreenRef.current =
      term.buffer.active.baseY > 0 || term.buffer.active.cursorY > 0;

    if (tauriUnsubRef.current) {
      tauriUnsubRef.current();
      tauriUnsubRef.current = null;
    }

    onUpdateTabStatus(tab.id, 'reconnecting');
    stayAtBottomIfPinned(term);

    void (async () => {
      try {
        // Close first with no listener attached, so the teardown DISCONNECTED
        // event cannot mark this new attempt as disconnected.
        await closeSession(tab.id);
        if (epoch !== localConnectEpochRef.current) return;

        tauriUnsubRef.current = onSessionEvent((msg: SessionEvent) => {
          if (msg.sessionId !== tab.id) return;
          if (epoch !== localConnectEpochRef.current) return;

          if (msg.type === 'STATUS' && msg.message) {
            term.write(`\x1b[33m${msg.message}\x1b[0m\r\n`);
            stayAtBottomIfPinned(term);
          } else if (msg.type === 'CONNECTED') {
            onUpdateTabStatus(tab.id, 'connected');
            stayAtBottomIfPinned(term);
            setTimeout(() => {
              term.focus();
              stayAtBottomIfPinned(term);
            }, 100);
          } else if (msg.type === 'DATA' && msg.data != null) {
            appendSessionLog(msg.data, 'RX');
            writeIncomingTerminalData(term, msg.data);
            try {
              AutoSuggestEngine.indexRemoteOutput(msg.data);
            } catch {}
            requestAnimationFrame(() => scheduleSuggestionUpdate(inputBufferRef.current));
          } else if (msg.type === 'ERROR') {
            term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
            stayAtBottomIfPinned(term);
          } else if (msg.type === 'DISCONNECTED') {
            term.write(`\r\n\x1b[33mLocal shell exited.\x1b[0m\r\n`);
            onUpdateTabStatus(tab.id, 'disconnected');
            stayAtBottomIfPinned(term);
          }
        });

        await openLocalSession(tab.id, { rows: term.rows, cols: term.cols });
        if (epoch !== localConnectEpochRef.current) return;

        onUpdateTabStatus(tab.id, 'connected');
        stayAtBottomIfPinned(term);
        setTimeout(() => {
          term.focus();
          stayAtBottomIfPinned(term);
        }, 100);
      } catch (err) {
        if (epoch !== localConnectEpochRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
        onUpdateTabStatus(tab.id, 'disconnected');
      }
    })();
  };
  const connectLocalShellRef = useRef(connectLocalShell);
  connectLocalShellRef.current = connectLocalShell;

  const handleReconnect = () => {
    // Cancel any background auto-reconnect and start a fresh user-driven connect
    serialConnectEpochRef.current += 1;
    suppressAutoReconnectRef.current = true;
    clearAutoReconnectTimer();
    autoReconnectAttemptRef.current = 0;
    closeSerialSocket();

    onUpdateTabStatus(tab.id, 'reconnecting');
    if (xtermRef.current) {
      if (tab.protocol === 'serial') {
        // Allow auto-reconnect again only after this session connects successfully
        suppressAutoReconnectRef.current = false;
        hadSerialConnectionRef.current = false;
        connectSerialWebSocket(xtermRef.current, 1, false);
      } else if (tab.protocol === 'ssh') {
        connectSSHWebSocket(xtermRef.current, 1);
      } else if (tab.protocol === 'local') {
        connectLocalShell(xtermRef.current);
      }
    }
  };

  const writeClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false;
    try {
      await writeClipboardText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  };

  const handleCopySelection = async () => {
    const selection = savedSelectionRef.current || xtermRef.current?.getSelection() || '';
    const text =
      selection ||
      (isLoggingRef.current && sessionLogRef.current
        ? sessionLogRef.current
        : xtermRef.current?.buffer.active
          ? Array.from({ length: xtermRef.current.buffer.active.length }, (_, i) =>
              xtermRef.current!.buffer.active.getLine(i)?.translateToString(true) ?? ''
            )
              .join('\n')
              .trimEnd()
          : '');
    if (!text) return;
    const ok = await writeClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handlePasteClipboard = async () => {
    let text = '';
    try {
      text = await readClipboardText();
    } catch {
      return;
    }
    if (!text) return;

    if (tab.protocol === 'serial') {
      if (serialTxModeRef.current === 'HEX') {
        setSerialInputText(text.trim());
        return;
      }
      const canSend =
        isTauriRuntime() || socketRef.current?.readyState === WebSocket.OPEN;
      if (!canSend) return;

      const ending = serialLineEndingRef.current;
      const eol =
        ending === 'CRLF' ? '\r\n' : ending === 'LF' ? '\n' : ending === 'CR' ? '\r' : '';
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      const hadTrailingNl = /[\r\n]$/.test(text);

      const data =
        ending === 'NONE'
          ? text
          : lines
              .map((line, idx) => {
                const isLast = idx === lines.length - 1;
                if (isLast && !hadTrailingNl) return line;
                return line + eol;
              })
              .join('');

      sendSessionData({ data });
      xtermRef.current?.write(
        `\r\n\x1b[1;36m[TX ${ending} paste -> ${tab.serialConfig?.path || 'COM'}] ${lines.length} line(s)\x1b[0m\r\n`
      );
      return;
    }

    // SSH / local: normalize to CR for PTY, or paste locally
    const cleanText = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'DATA', data: cleanText }));
    } else if (isTauriRuntime()) {
      sendSessionData({ data: cleanText });
    } else if (xtermRef.current) {
      xtermRef.current.paste(cleanText);
    }
  };

  const acceptInlineSuggestion = (term: Terminal, isLocal: boolean): boolean => {
    const suggestion = ghostSuggestionRef.current;
    if (!suggestion) return false;

    inputBufferRef.current += suggestion;
    hideInlineSuggestion();

    // Suppress the Tab/→ key that may still reach onData
    suppressSuggestKeyRef.current = true;
    queueMicrotask(() => {
      suppressSuggestKeyRef.current = false;
    });

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'DATA', data: suggestion }));
    } else if (isTauriRuntime()) {
      sendSessionData({ data: suggestion });
    } else if (isLocal) {
      term.write(suggestion);
    }

    scheduleSuggestionUpdate(inputBufferRef.current);
    return true;
  };

  const handleTerminalKey = (domEvent: KeyboardEvent, term: Terminal, isLocal: boolean = false): boolean => {
    if (!domEvent || domEvent.type !== 'keydown') return true;

    const keyName = (domEvent.key || '').toLowerCase();
    const isCtrlC = (domEvent.ctrlKey || domEvent.metaKey) && keyName === 'c';
    const isCtrlV = (domEvent.ctrlKey || domEvent.metaKey) && keyName === 'v';
    const isShiftInsert = domEvent.shiftKey && domEvent.key === 'Insert';

    if (isCtrlC) {
      const selection = term.getSelection();
      if (selection) {
        savedSelectionRef.current = selection;
        void writeClipboard(selection).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
        // Block xterm from also sending ^C / SIGINT when copying
        return false;
      }
      // No selection → allow ^C through to the remote session
      return true;
    }

    if (isCtrlV || isShiftInsert) {
      void handlePasteClipboard();
      return false;
    }

    const isRightArrow = domEvent.key === 'ArrowRight' || domEvent.code === 'ArrowRight';
    const isTab = domEvent.key === 'Tab' || domEvent.code === 'Tab';

    // Accept inline suggestion with Tab or → (standard editor behavior)
    if ((isTab || isRightArrow) && ghostSuggestionRef.current) {
      domEvent.preventDefault();
      domEvent.stopPropagation();
      acceptInlineSuggestion(term, isLocal);
      return false; // do not send Tab / arrow to the remote shell
    }

    return true;
  };

  handleTerminalKeyRef.current = handleTerminalKey;
  acceptInlineSuggestionRef.current = acceptInlineSuggestion;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    savedSelectionRef.current = xtermRef.current?.getSelection() || '';

    const approxW = 200;
    const approxH = 168;
    const pad = 8;
    let x = e.clientX;
    let y = e.clientY;
    if (x + approxW > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - approxW - pad);
    if (y + approxH > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - approxH - pad);
    if (x < pad) x = pad;
    if (y < pad) y = pad;

    setContextMenu({ x, y, hasSelection: Boolean(savedSelectionRef.current) });
  };

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;

    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x < pad) x = pad;
    if (y < pad) y = pad;

    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu({ ...contextMenu, x, y });
    }
  }, [contextMenu]);

  const handleToggleLogging = () => {
    const next = !isLogging;
    setIsLogging(next);
    isLoggingRef.current = next;

    if (!next) {
      if (logIdleTimerRef.current) {
        window.clearTimeout(logIdleTimerRef.current);
        logIdleTimerRef.current = null;
      }
      flushLogRemainder();
    }

    if (next && sessionLogRef.current.length === 0) {
      sessionLogRef.current = buildLogHeader();
      setLogSize(sessionLogRef.current.length);
    }

    xtermRef.current?.write(
      `\r\n\x1b[90mSession logging ${next ? 'on' : 'off'}\x1b[0m\r\n`
    );
  };

  const handleDownloadLog = () => {
    if (logIdleTimerRef.current) {
      window.clearTimeout(logIdleTimerRef.current);
      logIdleTimerRef.current = null;
    }
    flushLogRemainder();

    const savedLen = sessionLogRef.current.length;
    const body = sessionLogRef.current.trim();
    if (!body) {
      showLogNotice('No session log yet. Turn on Log first.');
      return;
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeName = tab.title.replace(/[^\w.-]+/g, '_');
    const logData =
      (body.endsWith('\n') ? body : `${body}\n`) +
      `\n--- End of log · downloaded ${new Date().toISOString()} ---\n`;

    showLogNotice('Saving session log…');
    void (async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      try {
        const saved = await saveTextFile(`sshark_${safeName}_${stamp}.log`, logData);
        if (!saved) {
          showLogNotice('Save cancelled');
          return;
        }
        const leftover = sessionLogRef.current.slice(savedLen);
        sessionLogRef.current = isLoggingRef.current ? buildLogHeader() + leftover : leftover;
        setLogSize(sessionLogRef.current.length);
        showLogNotice('Session log downloaded');
      } catch {
        showLogNotice('Could not save the log file');
      }
    })();
  };

  return (
    <div
      className={`terminal-tab-pane${isActive ? ' is-active' : ''}`}
      style={{ background: '#0e0e11' }}
    >
      <div className="surface-bar justify-between text-[12px]">
        <div className="flex items-center gap-2 min-w-0">
          {tab.status === 'connected' && (
            <span className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--ok)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ok)' }} />
              Connected
            </span>
          )}
          {tab.status === 'reconnecting' && (
            <span className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
              Reconnecting…
            </span>
          )}
          {tab.status === 'disconnected' && (
            <span className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--danger)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
              Disconnected
            </span>
          )}

          <span className="divider-v" />

          {tab.protocol === 'serial' ? (
            <div className="flex items-center gap-2 font-mono text-[12px]">
              <Cpu className="w-3.5 h-3.5" style={{ color: 'var(--icon)' }} />
              <span style={{ color: 'var(--text-bright)' }}>{tab.serialConfig?.path || 'COM'}</span>
              <select
                value={currentBaudRate}
                onChange={(e) => handleBaudRateChange(Number(e.target.value))}
                style={{ minHeight: 26, height: 26, padding: '0 6px', width: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12 }}
              >
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
          ) : (
            <span className="font-mono text-[12px] truncate" style={{ color: 'var(--text-muted)' }}>
              {tab.protocol === 'ssh'
                ? `${tab.sshConfig?.username}@${tab.sshConfig?.host}:${tab.sshConfig?.port}`
                : 'Local'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {tab.protocol === 'ssh' && onOpenSFTPTab && (
            <button onClick={() => onOpenSFTPTab(tab)} className="tb-btn" title="Open remote files">
              <FolderOpen className="w-3.5 h-3.5" />
              Files
            </button>
          )}

          {tab.protocol === 'serial' && (
            <>
              <button
                onClick={() => {
                  const nextMode = !isHexMode;
                  if (!nextMode) flushPendingHexView();
                  else hexPendingRef.current = [];
                  setIsHexMode(nextMode);
                  xtermRef.current?.write(`\r\n\x1b[90m${nextMode ? 'HEX' : 'ASCII'} view\x1b[0m\r\n`);
                }}
                className={`tb-btn ${isHexMode ? 'is-on' : ''}`}
                title="Hex view"
              >
                <Binary className="w-3.5 h-3.5" />
                Hex
              </button>
              <button
                onClick={() => {
                  const next = !isTimestampMode;
                  setIsTimestampMode(next);
                  xtermRef.current?.write(`\r\n\x1b[90mTimestamps ${next ? 'on' : 'off'}\x1b[0m\r\n`);
                }}
                className={`tb-btn ${isTimestampMode ? 'is-on' : ''}`}
                title="Timestamps"
              >
                <Clock className="w-3.5 h-3.5" />
                Time
              </button>
            </>
          )}

          <button
            onClick={() => {
              const next = !autoScroll;
              pointerDownRef.current = false;
              setAutoScroll(next);
              if (next) xtermRef.current?.scrollToBottom();
            }}
            className={`tb-btn ${autoScroll ? 'is-on' : ''}`}
            title="Auto-scroll"
          >
            <ChevronsDown className="w-3.5 h-3.5" />
            Scroll
          </button>

          <div className="tb-log-cluster">
          <button
            onClick={handleToggleLogging}
            className={`tb-btn ${isLogging ? 'is-on' : ''}`}
            title={isLogging ? 'Session logging on — click to stop' : 'Enable session logging'}
          >
            <FileText className="w-3.5 h-3.5" />
            Log
            {isLogging && logSize > 0 && (
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                {logSize > 1024 ? `${Math.round(logSize / 1024)}k` : `${logSize}b`}
              </span>
            )}
          </button>

          <span className="divider-v mx-1" />

          <button onClick={handleCopySelection} className="btn-icon" title="Copy" style={{ width: 26, height: 26 }}>
            {copied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button onClick={handlePasteClipboard} className="btn-icon" title="Paste" style={{ width: 26, height: 26 }}>
            <Clipboard className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleClear} className="btn-icon" title="Clear" style={{ width: 26, height: 26 }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDownloadLog}
            className="btn-icon"
            title={logSize > 0 ? 'Download session log' : 'Download session log (enable Log first)'}
            style={{
              width: 26,
              height: 26,
              color: logSize > 0 ? 'var(--text-bright)' : 'var(--text-faint)',
            }}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          {logNotice && <div className="tb-action-notice">{logNotice}</div>}
          </div>

          {tab.status === 'connected' ? (
            <button onClick={handleDisconnect} className="tb-btn tb-btn-danger ml-1" title="Disconnect">
              <Power className="w-3 h-3" />
              Disconnect
            </button>
          ) : (
            <button onClick={handleReconnect} className="tb-btn tb-btn-ok ml-1" title="Connect">
              <Plug className="w-3 h-3" />
              Connect
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col relative overflow-hidden">
        <div className="terminal-shell flex-1 flex flex-col overflow-hidden">
          <div className="terminal-viewport-host">
            <div
              ref={terminalRef}
              onClick={() => {
                if (suspendTerminalFocus) return;
                xtermRef.current?.focus();
              }}
              onContextMenu={handleContextMenu}
              className="terminal-viewport cursor-text"
            />
            <span ref={suggestionBadgeRef} className="xterm-ghost-text" aria-hidden />
          </div>

        {tab.protocol === 'serial' && (
          <div className="serial-tx-bar flex items-center gap-2">
            <select
              value={serialTxMode}
              onChange={(e) => setSerialTxMode(e.target.value as any)}
              className="tb-select tb-select-mode"
              title="TX encoding"
            >
              <option value="ASCII">ASCII</option>
              <option value="HEX">HEX</option>
            </select>
            <select
              value={serialLineEnding}
              onChange={(e) => setSerialLineEnding(e.target.value as any)}
              className="tb-select tb-select-eol"
              disabled={serialTxMode === 'HEX'}
              title={serialTxMode === 'HEX' ? 'Line ending applies in ASCII mode only — include 0D/0A in hex if needed' : 'Line ending'}
              style={serialTxMode === 'HEX' ? { opacity: 0.45 } : undefined}
            >
              <option value="CRLF">CRLF (\r\n)</option>
              <option value="LF">LF (\n)</option>
              <option value="CR">CR (\r)</option>
              <option value="NONE">NONE</option>
            </select>
            <input
              type="text"
              placeholder={
                serialTxMode === 'HEX'
                  ? 'Hex bytes, e.g. 41 54 0D 0A'
                  : `Send to ${tab.serialConfig?.path || 'COM'}…`
              }
              value={serialInputText}
              onChange={(e) => setSerialInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendSerialCommand()}
              className="flex-1 font-mono"
              style={{ minHeight: 28, height: 28, fontSize: 12 }}
            />
            <button
              onClick={() => handleSendSerialCommand()}
              className="btn-ide-primary shrink-0"
              title="Send"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              Send
            </button>
          </div>
        )}
        </div>

        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="ctx-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="ctx-menu-item"
              disabled={!contextMenu.hasSelection}
              onClick={() => {
                void handleCopySelection().then(() => setContextMenu(null));
              }}
            >
              <span className="ctx-menu-item-left">
                <Copy className="w-3.5 h-3.5" /> Copy
              </span>
              <span className="ctx-menu-kbd">Ctrl+C</span>
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                void handlePasteClipboard().then(() => setContextMenu(null));
              }}
            >
              <span className="ctx-menu-item-left">
                <Clipboard className="w-3.5 h-3.5" /> Paste
              </span>
              <span className="ctx-menu-kbd">Ctrl+V</span>
            </button>
            <div className="ctx-menu-sep" />
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                xtermRef.current?.selectAll();
                savedSelectionRef.current = xtermRef.current?.getSelection() || '';
                setContextMenu(null);
              }}
            >
              <span className="ctx-menu-item-left">
                <Binary className="w-3.5 h-3.5" /> Select all
              </span>
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                handleClear();
                setContextMenu(null);
              }}
            >
              <span className="ctx-menu-item-left">
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
