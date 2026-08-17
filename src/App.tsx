import React, { useState, useEffect } from 'react';
import {
  Plus,
  X,
  SquareTerminal,
  Cpu,
  Terminal as TerminalIcon,
  FolderOpen,
  Search,
  Sidebar as SidebarIcon,
  Code,
  Layers,
} from 'lucide-react';
import type { Session, Snippet, TerminalTab as TabType, Workspace } from './types/terminal';
import { SessionStore } from './services/sessionStore';
import { WorkspaceStore } from './services/workspaceStore';
import { Sidebar } from './components/Sidebar';
import { SessionModal } from './components/SessionModal';
import { TerminalTab } from './components/TerminalTab';
import { DualPaneSFTPExplorer } from './components/DualPaneSFTPExplorer';
import { SnippetDrawer } from './components/SnippetDrawer';
import { CommandPalette } from './components/CommandPalette';
import { WorkspaceModal } from './components/WorkspaceModal';
import { TerminalBridge } from './services/terminalBridge';
import { WindowControls } from './components/WindowControls';
import { closeSession, isTauriRuntime } from './services/sessionBackend';
import { detectOs, usesCustomWindowControls } from './services/platform';
import { getCurrentWindow } from '@tauri-apps/api/window';

type ProtocolPrefill = 'ssh' | 'serial' | 'local' | undefined;

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tabs, setTabs] = useState<TabType[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [sessionModalProtocol, setSessionModalProtocol] = useState<ProtocolPrefill>(undefined);
  const [sessionModalKey, setSessionModalKey] = useState(0);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [isSnippetDrawerOpen, setIsSnippetDrawerOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  };

  const openNewSession = (protocol?: ProtocolPrefill) => {
    if (protocol === 'local') {
      const existing = sessions.find((s) => s.protocol === 'local');
      if (existing) {
        const existingTab = tabs.find((t) => t.sessionId === existing.id);
        if (existingTab) {
          setActiveTabId(existingTab.id);
          return;
        }
        const newTab: TabType = {
          id: `tab-${Date.now()}`,
          sessionId: existing.id,
          title: existing.name,
          protocol: 'local',
          status: 'connected',
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        return;
      }
      const session: Session = {
        id: `session-local-${Date.now()}`,
        name: 'Local Shell',
        protocol: 'local',
        group: 'Local',
        favorite: true,
      };
      const updated = [session, ...sessions];
      setSessions(updated);
      SessionStore.saveSessions(updated);
      const newTab: TabType = {
        id: `tab-${Date.now()}`,
        sessionId: session.id,
        title: session.name,
        protocol: 'local',
        status: 'connected',
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      return;
    }
    setEditingSession(null);
    setSessionModalProtocol(protocol);
    setSessionModalKey((k) => k + 1);
    setIsSessionModalOpen(true);
  };

  const openEditSession = (session: Session) => {
    // Open on the next tick so the context-menu click cannot hit the new modal.
    window.setTimeout(() => {
      setEditingSession(session);
      setSessionModalProtocol(session.protocol);
      setSessionModalKey((k) => k + 1);
      setIsSessionModalOpen(true);
    }, 0);
  };

  useEffect(() => {
    setSessions(SessionStore.getSessions());
    setSnippets(SessionStore.getSnippets());
    setWorkspaces(WorkspaceStore.getWorkspaces());
    setTabs([]);
    setActiveTabId('');
  }, []);

  useEffect(() => {
    TerminalBridge.setActive(activeTabId || null);
  }, [activeTabId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openNewSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleOpenSessionTab = (session: Session) => {
    const newTab: TabType = {
      id: `tab-${Date.now()}`,
      sessionId: session.id,
      title: session.name,
      protocol: session.protocol,
      status: 'connected',
      sshConfig: session.sshConfig,
      serialConfig: session.serialConfig,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleFocusSession = (session: Session) => {
    const existing = tabs.find((t) => t.sessionId === session.id);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    handleOpenSessionTab(session);
  };

  const handleSaveNewSession = (newSession: Session) => {
    const updated = [newSession, ...sessions];
    setSessions(updated);
    SessionStore.saveSessions(updated);
    handleOpenSessionTab(newSession);
  };

  const handleSaveSession = (session: Session) => {
    const exists = sessions.some((s) => s.id === session.id);
    const normalized: Session =
      session.protocol === 'ssh'
        ? { ...session, serialConfig: undefined }
        : session.protocol === 'serial'
          ? { ...session, sshConfig: undefined }
          : { ...session, sshConfig: undefined, serialConfig: undefined };

    if (!exists) {
      handleSaveNewSession(normalized);
      return;
    }

    const updated = sessions.map((s) => (s.id === session.id ? normalized : s));
    setSessions(updated);
    SessionStore.saveSessions(updated);
    setTabs((prev) =>
      prev.map((t) =>
        t.sessionId === normalized.id
          ? {
              ...t,
              title: normalized.name,
              protocol: normalized.protocol,
              sshConfig: normalized.sshConfig,
              serialConfig: normalized.serialConfig,
            }
          : t
      )
    );
    showToast(`Updated “${normalized.name}”`);
  };

  const handleDeleteSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);

    const belongsToSession = (t: TabType) => {
      if (t.sessionId === sessionId) return true;
      if (!session) return false;
      if (t.sessionId && t.sessionId !== sessionId) return false;
      if (t.title === session.name && t.protocol === session.protocol) return true;
      if (
        session.protocol === 'serial' &&
        t.protocol === 'serial' &&
        t.serialConfig?.path &&
        t.serialConfig.path === session.serialConfig?.path
      ) {
        return true;
      }
      if (
        session.protocol === 'ssh' &&
        t.protocol === 'ssh' &&
        t.sshConfig?.host === session.sshConfig?.host &&
        t.sshConfig?.username === session.sshConfig?.username
      ) {
        return true;
      }
      return false;
    };

    setTabs((prev) => {
      const closing = prev.filter(belongsToSession);
      for (const t of closing) {
        void closeSession(t.id);
      }
      const remaining = prev.filter((t) => !belongsToSession(t));
      setActiveTabId((current) => {
        if (remaining.some((t) => t.id === current)) return current;
        return remaining.length > 0 ? remaining[remaining.length - 1].id : '';
      });
      return remaining;
    });

    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    SessionStore.saveSessions(updated);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void closeSession(tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId && newTabs.length > 0) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    } else if (newTabs.length === 0) {
      setActiveTabId('');
    }
  };

  const handleUpdateTabStatus = (tabId: string, status: TabType['status']) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status } : t)));
  };

  const handleOpenSFTPTab = (sourceTab: TabType) => {
    if (!sourceTab.sshConfig) {
      showToast('Open SFTP from an SSH session that has host credentials.');
      return;
    }
    const sftpTab: TabType = {
      id: `tab-sftp-${Date.now()}`,
      sessionId: sourceTab.sessionId,
      title: `Files · ${sourceTab.title}`,
      protocol: 'ssh',
      status: 'connected',
      sshConfig: sourceTab.sshConfig,
    };
    setTabs((prev) => [...prev, sftpTab]);
    setActiveTabId(sftpTab.id);
  };

  const handleRunSnippet = (snippet: Snippet) => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) {
      showToast('Open a terminal tab, then run a macro.');
      return;
    }
    const ok = TerminalBridge.inject(snippet.command);
    if (!ok) {
      showToast('Connect the terminal first, then run the macro.');
      return;
    }
    const cmd = snippet.command.trim();
    const preview = cmd.length > 72 ? `${cmd.slice(0, 69)}…` : cmd;
    showToast(`Sent: ${preview}`);
  };

  const handleAddSnippet = (newSnippet: Snippet) => {
    const updated = [newSnippet, ...snippets];
    setSnippets(updated);
    SessionStore.saveSnippets(updated);
  };

  const handleDeleteSnippet = (snippetId: string) => {
    const updated = snippets.filter((s) => s.id !== snippetId);
    setSnippets(updated);
    SessionStore.saveSnippets(updated);
  };

  const handleLoadWorkspace = (ws: Workspace) => {
    setTabs((prev) => {
      for (const t of prev) {
        void closeSession(t.id);
      }
      return ws.tabs;
    });
    setActiveTabId(ws.tabs[0]?.id || '');
    setActiveLayoutId(ws.id);
  };

  const handleSaveWorkspace = (newWs: Workspace) => {
    const updated = [newWs, ...workspaces];
    setWorkspaces(updated);
    WorkspaceStore.saveWorkspaces(updated);
    showToast(`Saved workspace “${newWs.name}”`);
  };

  const handleDeleteWorkspace = (wsId: string) => {
    const ws = workspaces.find((w) => w.id === wsId);
    const updated = workspaces.filter((w) => w.id !== wsId);
    setWorkspaces(updated);
    WorkspaceStore.saveWorkspaces(updated);

    if (!ws || activeLayoutId !== wsId) return;

    const layoutTabIds = new Set(ws.tabs.map((t) => t.id));
    setTabs((prev) => {
      const closing = prev.filter((t) => layoutTabIds.has(t.id));
      for (const t of closing) {
        void closeSession(t.id);
      }
      const remaining = prev.filter((t) => !layoutTabIds.has(t.id));
      setActiveTabId((current) => {
        if (remaining.some((t) => t.id === current)) return current;
        return remaining.length > 0 ? remaining[remaining.length - 1].id : '';
      });
      return remaining;
    });
    setActiveLayoutId(null);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isSftpTab = (tab: TabType) => tab.title.startsWith('Files') || tab.title.includes('SFTP');
  const os = detectOs();
  const showWindowControls = isTauriRuntime() && usesCustomWindowControls();
  const modalOpen =
    isSessionModalOpen || isWorkspaceModalOpen || isCommandPaletteOpen;

  const toggleMaximize = () => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().toggleMaximize();
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden app-root" style={{ background: 'var(--bg-app)', color: 'var(--text)' }}>
      {/* Native drag region only — do not also call startDragging() (breaks later drags on WebView2). */}
      <header
        className={`app-chrome${os === 'macos' ? ' is-macos' : ''}${os === 'linux' ? ' is-linux' : ''}`}
        {...(os === 'windows' ? { 'data-tauri-drag-region': true } : {})}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onDoubleClick={(e) => {
          if (os !== 'windows') return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('button, a, input, select, textarea, .tab-chip, .window-controls, .app-chrome-actions')) {
            return;
          }
          toggleMaximize();
        }}
      >
        <img
          src="/tef-logo.png"
          alt="Tef"
          title="Tef"
          data-tauri-drag-region
          className="w-7 h-7 rounded-full shrink-0 object-cover"
          draggable={false}
        />

        <div className="app-chrome-tabs" data-tauri-drag-region="false">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                data-tauri-drag-region="false"
                onClick={() => setActiveTabId(tab.id)}
                className={`tab-chip${isActive ? ' is-active' : ''}`}
                style={{
                  background: isActive ? undefined : 'transparent',
                  color: isActive ? undefined : 'var(--text-muted)',
                }}
              >
                {isSftpTab(tab) ? (
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--sftp)' }} />
                ) : tab.protocol === 'ssh' ? (
                  <SquareTerminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ssh)' }} />
                ) : tab.protocol === 'serial' ? (
                  <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--serial)' }} />
                ) : (
                  <TerminalIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--local)' }} />
                )}
                <span className="truncate min-w-0">{tab.title}</span>
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="tab-chip-close"
                  title="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="app-chrome-spacer" data-tauri-drag-region />

        <div className="app-chrome-actions" data-tauri-drag-region="false">
          <button
            onClick={() => openNewSession()}
            className="btn-ide-primary"
            title="New connection (Ctrl+N)"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="chrome-btn-label">New</span>
          </button>
          <button
            onClick={() => setIsWorkspaceModalOpen(true)}
            className="btn-ide-secondary btn-icon-only"
            title="Saved tab layouts"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="btn-ide-secondary btn-icon-only"
            title="Quick search (Ctrl+P)"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsSnippetDrawerOpen(!isSnippetDrawerOpen)}
            className="btn-ide-secondary btn-icon-only"
            style={{
              background: isSnippetDrawerOpen
                ? 'var(--md-sys-color-primary-container)'
                : 'var(--md-sys-color-secondary-container)',
              color: isSnippetDrawerOpen
                ? 'var(--md-sys-color-on-primary-container)'
                : 'var(--md-sys-color-on-secondary-container)',
            }}
            title="Command macros"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          {showWindowControls && (
            <>
              <div className="app-chrome-sep" aria-hidden />
              <WindowControls />
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {isSidebarOpen ? (
          <Sidebar
            sessions={sessions}
            activeSessionId={activeTab?.sessionId}
            onOpenSessionTab={handleOpenSessionTab}
            onFocusSession={handleFocusSession}
            onEditSession={openEditSession}
            onNewSessionClick={() => openNewSession()}
            onDeleteSession={handleDeleteSession}
            onToggleCollapse={() => setIsSidebarOpen(false)}
          />
        ) : (
          <div className="explorer-collapsed-rail" title="Show connections">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="tab-bar-toggle"
              title="Show connections"
            >
              <SidebarIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <main className="flex-1 flex flex-col h-full overflow-hidden relative" style={{ background: 'var(--bg-app)' }}>
          {tabs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 text-center">
              <img
                src="/tef-logo.png"
                alt="Tef"
                className="w-14 h-14 rounded-full object-cover mb-6"
                draggable={false}
              />
              <h1 className="text-[22px] font-semibold mb-3" style={{ color: 'var(--text-bright)' }}>
                Connect to a device
              </h1>
              <p className="text-[13px] max-w-md leading-relaxed" style={{ color: 'var(--text-muted)', marginBottom: 36 }}>
                Start with SSH for remote servers, Serial for COM/USB hardware, or open a saved session from the sidebar.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl mx-auto" style={{ marginBottom: 36 }}>
                <button
                  onClick={() => openNewSession('ssh')}
                  className="choice-card choice-card--ssh"
                >
                  <SquareTerminal className="w-7 h-7 choice-card-icon" />
                  <div className="choice-card-title">SSH</div>
                  <div className="choice-card-desc">Remote Linux / network shell</div>
                </button>
                <button
                  onClick={() => openNewSession('serial')}
                  className="choice-card choice-card--serial"
                >
                  <Cpu className="w-7 h-7 choice-card-icon" />
                  <div className="choice-card-title">Serial</div>
                  <div className="choice-card-desc">COM ports & microcontrollers</div>
                </button>
                <button
                  onClick={() => openNewSession('local')}
                  className="choice-card choice-card--local"
                >
                  <TerminalIcon className="w-7 h-7 choice-card-icon" />
                  <div className="choice-card-title">Local</div>
                  <div className="choice-card-desc">Windows PowerShell / CMD</div>
                </button>
              </div>

              <p className="text-[12px]" style={{ color: 'var(--text-faint)', marginTop: 4 }}>
                Tip: <span className="font-mono">Ctrl+N</span> new connection · <span className="font-mono">Ctrl+P</span> search
              </p>
            </div>
          ) : (
            tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              if (isSftpTab(tab)) {
                return (
                  <div key={tab.id} className={`flex-1 h-full ${isActive ? 'block' : 'hidden'}`}>
                    <DualPaneSFTPExplorer sshConfig={tab.sshConfig} />
                  </div>
                );
              }
              return (
                <TerminalTab
                  key={tab.id}
                  tab={tab}
                  isActive={isActive}
                  onUpdateTabStatus={handleUpdateTabStatus}
                  onOpenSFTPTab={handleOpenSFTPTab}
                  suspendTerminalFocus={modalOpen}
                />
              );
            })
          )}
        </main>

        <SnippetDrawer
          isOpen={isSnippetDrawerOpen}
          snippets={snippets}
          onClose={() => setIsSnippetDrawerOpen(false)}
          onRunSnippet={handleRunSnippet}
          onAddSnippet={handleAddSnippet}
          onDeleteSnippet={handleDeleteSnippet}
        />
      </div>

      {toast && <div className="toast">{toast}</div>}

      <SessionModal
        key={sessionModalKey}
        isOpen={isSessionModalOpen}
        initialProtocol={sessionModalProtocol}
        initialSession={editingSession}
        onClose={() => {
          setIsSessionModalOpen(false);
          setSessionModalProtocol(undefined);
          setEditingSession(null);
        }}
        onSave={handleSaveSession}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        sessions={sessions}
        snippets={snippets}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectSession={handleOpenSessionTab}
        onRunSnippet={handleRunSnippet}
      />

      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        activeTabs={tabs}
        workspaces={workspaces}
        onClose={() => setIsWorkspaceModalOpen(false)}
        onLoadWorkspace={handleLoadWorkspace}
        onSaveWorkspace={handleSaveWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        onNotify={showToast}
      />
    </div>
  );
};

export default App;
