import React, { useState } from 'react';
import { X, Play, Plus, Trash2 } from 'lucide-react';
import type { Snippet } from '../types/terminal';

interface SnippetDrawerProps {
  isOpen: boolean;
  snippets: Snippet[];
  onClose: () => void;
  onRunSnippet: (snippet: Snippet) => void;
  onAddSnippet: (snippet: Snippet) => void;
  onDeleteSnippet: (snippetId: string) => void;
}

export const SnippetDrawer: React.FC<SnippetDrawerProps> = ({
  isOpen,
  snippets,
  onClose,
  onRunSnippet,
  onAddSnippet,
  onDeleteSnippet,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [command, setCommand] = useState('');
  const [category, setCategory] = useState('General');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !command) return;

    onAddSnippet({
      id: `snip-${Date.now()}`,
      title,
      command,
      category: category || 'Custom',
    });

    setTitle('');
    setCommand('');
    setIsAdding(false);
  };

  return (
    <aside className="side-panel w-80" style={{ borderLeft: '1px solid transparent' }}>
      <div className="side-panel-header justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold leading-none" style={{ color: 'var(--text-bright)' }}>
            Macros
          </span>
          <span
            className="text-[13px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--text-faint)' }}
          >
            · {snippets.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-icon shrink-0"
          style={{ width: 28, height: 28 }}
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isAdding ? (
        <form
          onSubmit={handleSubmit}
          className="side-panel-section"
          style={{
            background: 'var(--bg-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div className="flex justify-between items-center gap-2">
            <span className="text-[13px] font-medium leading-none" style={{ color: 'var(--text-bright)' }}>
              New macro
            </span>
            <button type="button" onClick={() => setIsAdding(false)} className="btn-ghost" style={{ height: 28 }}>
              Cancel
            </button>
          </div>

          <div>
            <label className="field-label">Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Restart nginx"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label">Command</label>
            <textarea
              required
              rows={3}
              placeholder="systemctl restart nginx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono text-[12px]"
              style={{ resize: 'vertical' }}
            />
          </div>

          <div>
            <label className="field-label">Category</label>
            <input
              type="text"
              placeholder="General"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <button type="submit" className="w-full btn-ide-primary" style={{ marginTop: 4 }}>
            Save macro
          </button>
        </form>
      ) : (
        <div className="side-panel-section flex items-center justify-between gap-3" style={{ background: 'var(--bg-app)' }}>
          <span className="text-[12px] leading-snug min-w-0" style={{ color: 'var(--text-muted)' }}>
            Send to active terminal
          </span>
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="btn-ide-primary shrink-0"
            style={{ height: 28, minHeight: 28, maxHeight: 28, padding: '0 10px' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      )}

      <div className="side-panel-body space-y-3">
        {snippets.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[13px] mb-1.5 font-medium" style={{ color: 'var(--text-bright)' }}>
              No macros yet
            </p>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Add one for commands you run often.
            </p>
          </div>
        ) : (
          snippets.map((snip) => (
            <div
              key={snip.id}
              className="macro-card"
            >
              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate leading-snug" style={{ color: 'var(--text-bright)' }}>
                    {snip.title}
                  </div>
                  <div className="text-[11px] mt-1 truncate leading-snug" style={{ color: 'var(--text-faint)' }}>
                    {snip.category || 'General'}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onDeleteSnippet(snip.id)}
                    className="btn-icon"
                    style={{ width: 28, height: 28 }}
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunSnippet(snip)}
                    className="btn-ide-secondary"
                    style={{ height: 28, minHeight: 28, maxHeight: 28, padding: '0 10px' }}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Send
                  </button>
                </div>
              </div>

              <div
                className="text-[11px] font-mono break-all px-2.5 py-2 rounded"
                style={{ background: 'var(--bg-panel)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                {snip.command}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
