import React, { useState } from 'react';
import { X, Layers, Plus, Download, Upload, Trash2, Play } from 'lucide-react';
import type { Workspace, TerminalTab } from '../types/terminal';
import { WorkspaceStore } from '../services/workspaceStore';
import { isTauriRuntime, saveTextFile } from '../services/sessionBackend';

interface WorkspaceModalProps {
  isOpen: boolean;
  activeTabs: TerminalTab[];
  workspaces: Workspace[];
  onClose: () => void;
  onLoadWorkspace: (workspace: Workspace) => void;
  onSaveWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  activeTabs,
  workspaces,
  onClose,
  onLoadWorkspace,
  onSaveWorkspace,
  onDeleteWorkspace,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [importJsonText, setImportJsonText] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  if (!isOpen) return null;

  const handleCreateWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newWs: Workspace = {
      id: `ws-${Date.now()}`,
      name,
      description: description || 'Saved layout',
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      tabs: activeTabs,
    };

    onSaveWorkspace(newWs);
    setName('');
    setDescription('');
    setIsCreating(false);
  };

  const handleExportJSON = async (ws: Workspace) => {
    const json = WorkspaceStore.exportWorkspaceJSON(ws);
    const filename = `workspace_${ws.name.replace(/\s+/g, '_')}.json`;
    try {
      await saveTextFile(filename, json);
    } catch {
      if (!isTauriRuntime()) {
        alert('Could not download the layout file.');
      }
    }
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!importJsonText.trim()) return;

    const imported = WorkspaceStore.parseWorkspaceJSON(importJsonText);
    if (imported) {
      onSaveWorkspace(imported);
      setImportJsonText('');
      setIsImporting(false);
    } else {
      alert('Invalid workspace JSON format.');
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card max-w-xl">
        <div className="modal-header">
          <div className="flex items-start gap-3">
            <Layers className="w-3.5 h-3.5 mt-0.5" style={{ color: 'var(--icon)' }} />
            <div>
              <h2 className="font-semibold text-[16px]" style={{ color: 'var(--text-bright)' }}>
                Layouts
              </h2>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Save and restore your open tabs.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ width: 32, padding: 0 }} title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="modal-body">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {workspaces.length} saved layout{workspaces.length === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsImporting(!isImporting);
                  setIsCreating(false);
                }}
                className="btn-ide-secondary"
              >
                <Upload className="w-3.5 h-3.5" />
                Import
              </button>
              <button
                onClick={() => {
                  setIsCreating(!isCreating);
                  setIsImporting(false);
                }}
                className="btn-ide-primary"
              >
                <Plus className="w-3.5 h-3.5" />
                Save current
              </button>
            </div>
          </div>

          {isCreating && (
            <form
              onSubmit={handleCreateWorkspace}
              className="p-4 space-y-3 rounded-md"
              style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}
            >
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-medium" style={{ color: 'var(--text-bright)' }}>
                  Save open tabs
                </span>
                <button type="button" onClick={() => setIsCreating(false)} className="btn-ghost">
                  Cancel
                </button>
              </div>

              <div>
                <label className="field-label">Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lab debug layout"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Description</label>
                <input
                  type="text"
                  placeholder="Optional note"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Captures {activeTabs.length} tab{activeTabs.length === 1 ? '' : 's'}
                {activeTabs.length > 0 ? `: ${activeTabs.map((t) => t.title).join(', ')}` : ''}
              </p>

              <button type="submit" className="btn-ide-primary w-full">
                Save layout
              </button>
            </form>
          )}

          {isImporting && (
            <form
              onSubmit={handleImportSubmit}
              className="p-4 space-y-3 rounded-md"
              style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}
            >
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-medium" style={{ color: 'var(--text-bright)' }}>
                  Import JSON
                </span>
                <button type="button" onClick={() => setIsImporting(false)} className="btn-ghost">
                  Cancel
                </button>
              </div>

              <textarea
                rows={4}
                required
                placeholder="Paste workspace JSON here..."
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                className="font-mono text-[12px]"
              />

              <button type="submit" className="btn-ide-primary w-full">
                Import
              </button>
            </form>
          )}

          <div className="max-h-64 overflow-y-auto space-y-2">
            {workspaces.length === 0 ? (
              <div className="py-8 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                No layouts yet. Open some tabs, then click Save current.
              </div>
            ) : (
              workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="p-3 rounded-md flex items-center justify-between gap-3"
                  style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-bright)' }}>
                      {ws.name}
                    </div>
                    <div className="text-[12px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {ws.description}
                    </div>
                    <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-faint)' }}>
                      {ws.createdAt} · {ws.tabs.length} tabs
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleExportJSON(ws)}
                      className="btn-ghost"
                      style={{ width: 32, padding: 0 }}
                      title="Export JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteWorkspace(ws.id)}
                      className="btn-ghost"
                      style={{ width: 32, padding: 0 }}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        onLoadWorkspace(ws);
                        onClose();
                      }}
                      className="btn-ide-primary"
                    >
                      <Play className="w-3 h-3" />
                      Open
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
