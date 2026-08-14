import React, { useState, useEffect } from 'react';
import { Search, SquareTerminal, Cpu, Terminal, Code } from 'lucide-react';
import type { Session, Snippet } from '../types/terminal';

interface CommandPaletteProps {
  isOpen: boolean;
  sessions: Session[];
  snippets: Snippet[];
  onClose: () => void;
  onSelectSession: (session: Session) => void;
  onRunSnippet: (snippet: Snippet) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  sessions,
  snippets,
  onClose,
  onSelectSession,
  onRunSnippet,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.toLowerCase();
  const filteredSessions = sessions.filter(
    (s) => s.name.toLowerCase().includes(q) || s.protocol.toLowerCase().includes(q)
  );
  const filteredSnippets = snippets.filter(
    (snip) => snip.title.toLowerCase().includes(q) || snip.command.toLowerCase().includes(q)
  );

  const protocolIcon = (protocol: string) => {
    if (protocol === 'serial') return <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />;
    if (protocol === 'local') return <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />;
    return <SquareTerminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card max-w-xl"
        style={{ overflow: 'hidden', marginTop: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="command-palette-search">
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            autoFocus
            placeholder="Search sessions or macros…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 shadow-none bg-transparent px-0"
            style={{ boxShadow: 'none', minHeight: 32, fontSize: 14 }}
          />
          <span
            className="text-[11px] font-mono shrink-0"
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-panel)',
              color: 'var(--text-faint)',
              border: '1px solid var(--border)',
            }}
          >
            Esc
          </span>
        </div>

        <div className="command-palette-list">
          {filteredSessions.length === 0 && filteredSnippets.length === 0 ? (
            <div className="command-palette-empty">
              No matches. Try another name, or create a connection first.
            </div>
          ) : (
            <>
              {filteredSessions.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div className="command-palette-label">Sessions</div>
                  {filteredSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => {
                        onSelectSession(session);
                        onClose();
                      }}
                      className="command-palette-item"
                    >
                      {protocolIcon(session.protocol)}
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-bright)' }}>
                          {session.name}
                        </div>
                        <div className="text-[11px] font-mono truncate mt-0.5" style={{ color: 'var(--text-faint)' }}>
                          {session.protocol}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {filteredSnippets.length > 0 && (
                <div>
                  <div className="command-palette-label">Macros</div>
                  {filteredSnippets.map((snip) => (
                    <button
                      key={snip.id}
                      type="button"
                      onClick={() => {
                        onRunSnippet(snip);
                        onClose();
                      }}
                      className="command-palette-item"
                    >
                      <Code className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--icon)' }} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-bright)' }}>
                          {snip.title}
                        </div>
                        <div className="text-[11px] font-mono truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {snip.command}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
