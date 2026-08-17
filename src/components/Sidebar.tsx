import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  SquareTerminal,
  Cpu,
  Terminal,
  Search,
  Folder,
  FolderOpen,
  Trash2,
  ChevronRight,
  ChevronDown,
  PanelLeft,
  Plus,
  Pencil,
} from 'lucide-react';
import type { Session } from '../types/terminal';

const SIDEBAR_WIDTH_KEY = 'tef.explorerWidth';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 288;

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return SIDEBAR_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

interface SidebarProps {
  sessions: Session[];
  activeSessionId?: string;
  onOpenSessionTab: (session: Session) => void;
  onFocusSession: (session: Session) => void;
  onEditSession: (session: Session) => void;
  onNewSessionClick: () => void;
  onDeleteSession: (sessionId: string) => void;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onOpenSessionTab,
  onFocusSession,
  onEditSession,
  onNewSessionClick,
  onDeleteSession,
  onToggleCollapse,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(loadSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: Session } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(width);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad);
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu({ ...contextMenu, x, y });
    }
  }, [contextMenu]);

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: widthRef.current };
    setIsResizing(true);
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const next = Math.min(
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, dragRef.current.startWidth + (e.clientX - dragRef.current.startX))
    );
    setWidth(next);
  }, []);

  const endResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(widthRef.current)));
    } catch {
      /* ignore quota */
    }
  }, []);

  const toggleFolder = (group: string) => {
    setExpandedFolders((prev) => ({ ...prev, [group]: !(prev[group] !== false) }));
  };

  const filteredSessions = sessions.filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.group && s.group.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const groupedSessions = filteredSessions.reduce((acc, session) => {
    const group = session.group || 'Ungrouped';
    if (!acc[group]) acc[group] = [];
    acc[group].push(session);
    return acc;
  }, {} as Record<string, Session[]>);

  const getProtocolIcon = (protocol: string) => {
    switch (protocol) {
      case 'ssh':
        return <SquareTerminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />;
      case 'serial':
        return <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />;
      case 'local':
        return <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />;
      default:
        return <SquareTerminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} />;
    }
  };

  return (
    <aside
      className={`side-panel side-panel-explorer${isResizing ? ' is-resizing' : ''}`}
      style={{ width, borderRight: '1px solid transparent' }}
    >
      <div className="side-panel-header justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="tab-bar-toggle"
            title="Hide connections"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[13px] font-semibold leading-none" style={{ color: 'var(--text-bright)' }}>
            Connections
          </span>
          {sessions.length > 0 && (
            <span
              className="text-[13px] font-semibold leading-none tabular-nums"
              style={{ color: 'var(--text-faint)' }}
            >
              · {sessions.length}
            </span>
          )}
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="side-panel-section">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 absolute pointer-events-none"
              style={{ color: 'var(--text-faint)', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              placeholder="Filter connections…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 36, minHeight: 32, height: 32 }}
            />
          </div>
        </div>
      )}

      <div className="side-panel-body">
        {sessions.length === 0 ? (
          <div className="py-10 text-center px-1">
            <p className="text-[13px] mb-2 font-medium" style={{ color: 'var(--text-bright)' }}>
              No saved sessions
            </p>
            <p className="text-[12px] mb-5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Use <span className="font-medium" style={{ color: 'var(--text)' }}>New connection</span> in the top bar to get started.
            </p>
            <button onClick={onNewSessionClick} className="btn-ide-primary">
              New connection
            </button>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-8 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            No connections match “{searchTerm}”.
          </div>
        ) : (
          Object.entries(groupedSessions).map(([group, groupSessions]) => {
            const expanded = expandedFolders[group] !== false;
            return (
              <div key={group} className="mb-3">
                <button
                  onClick={() => toggleFolder(group)}
                  className="w-full flex items-center gap-2 py-2 text-[12px] font-medium"
                  style={{ color: 'var(--text)' }}
                >
                  {expanded ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
                  )}
                  {expanded ? (
                    <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--folder)' }} />
                  ) : (
                    <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--folder)' }} />
                  )}
                  <span className="truncate leading-none">{group}</span>
                  <span
                    className="ml-auto shrink-0 text-[12px] font-medium leading-none tabular-nums"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {groupSessions.length}
                  </span>
                </button>

                {expanded && (
                  <div className="mt-1 space-y-0.5" style={{ paddingLeft: 8 }}>
                    {groupSessions.map((session) => {
                      const isActive = session.id === activeSessionId;
                      return (
                        <div
                          key={session.id}
                          onClick={() => onFocusSession(session)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ x: e.clientX, y: e.clientY, session });
                          }}
                          className={`group session-row${isActive ? ' is-active' : ''}`}
                          style={{
                            background: isActive ? undefined : 'transparent',
                            color: isActive ? undefined : 'var(--text)',
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          {getProtocolIcon(session.protocol)}
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate font-medium leading-snug text-[13px]">{session.name}</div>
                            <div
                              className="text-[11px] truncate font-mono leading-snug mt-0.5"
                              style={{
                                color: isActive
                                  ? 'color-mix(in srgb, var(--md-sys-color-on-primary-container) 70%, transparent)'
                                  : 'var(--text-faint)',
                              }}
                            >
                              {session.protocol === 'ssh'
                                ? `${session.sshConfig?.username}@${session.sshConfig?.host}`
                                : session.protocol === 'serial'
                                  ? `${session.serialConfig?.path} · ${session.serialConfig?.baudRate}`
                                  : 'Local'}
                            </div>
                          </div>
                          <div className="session-row-actions">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenSessionTab(session);
                              }}
                              className="session-row-action session-row-open"
                              title="Open in new tab"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSession(session.id);
                              }}
                              className="session-row-action session-row-delete"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div
        className="explorer-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize explorer"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={Math.round(width)}
        title="Drag to resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => {
          setWidth(SIDEBAR_DEFAULT);
          widthRef.current = SIDEBAR_DEFAULT;
          try {
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT));
          } catch {
            /* ignore */
          }
        }}
      />

      {contextMenu &&
        createPortal(
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const session = contextMenu.session;
                setContextMenu(null);
                onEditSession(session);
              }}
            >
              <span className="ctx-menu-item-left">
                <Pencil className="w-3.5 h-3.5" /> Edit connection
              </span>
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                onOpenSessionTab(contextMenu.session);
                setContextMenu(null);
              }}
            >
              <span className="ctx-menu-item-left">
                <Plus className="w-3.5 h-3.5" /> Open in new tab
              </span>
            </button>
            <div className="ctx-menu-sep" />
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                onDeleteSession(contextMenu.session.id);
                setContextMenu(null);
              }}
            >
              <span className="ctx-menu-item-left">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </span>
            </button>
          </div>,
          document.body
        )}
    </aside>
  );
};
