import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FileText,
  RefreshCw,
  HardDrive,
  Lock,
  ArrowRightLeft,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';
import type { FileItem, SSHConfig } from '../types/terminal';
import { ChmodModal } from './ChmodModal';
import {
  localList,
  sftpChmod,
  sftpDownload,
  sftpList,
  sftpUpload,
} from '../services/sessionBackend';

interface DualPaneSFTPExplorerProps {
  sshConfig?: SSHConfig;
}

export const DualPaneSFTPExplorer: React.FC<DualPaneSFTPExplorerProps> = ({ sshConfig }) => {
  const [localPath, setLocalPath] = useState('');
  const [selectedLocalFile, setSelectedLocalFile] = useState<FileItem | null>(null);
  const [localFiles, setLocalFiles] = useState<FileItem[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [remotePath, setRemotePath] = useState(sshConfig?.username ? `/home/${sshConfig.username}` : '/');
  const [selectedRemoteFile, setSelectedRemoteFile] = useState<FileItem | null>(null);
  const [remoteFiles, setRemoteFiles] = useState<FileItem[]>([]);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  const [chmodModalOpen, setChmodModalOpen] = useState(false);
  const [chmodTargetFile, setChmodTargetFile] = useState<FileItem | null>(null);

  const authPayload = useCallback(() => {
    const config = sshConfig || {
      host: '127.0.0.1',
      port: 22,
      username: 'pi',
      authMethod: 'password' as const,
    };
    return {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKeyPath: config.privateKeyPath,
    };
  }, [sshConfig]);

  const fetchLocalDir = async (targetDir?: string) => {
    setIsLoadingLocal(true);
    setLocalError(null);
    try {
      const data = await localList(targetDir);
      setLocalPath(data.path);
      setLocalFiles(data.files || []);
      setSelectedLocalFile(null);
    } catch (err: any) {
      setLocalError(err.message);
    } finally {
      setIsLoadingLocal(false);
    }
  };

  const fetchRemoteSFTP = async (targetDir: string) => {
    setIsLoadingRemote(true);
    setRemoteError(null);
    try {
      const data = await sftpList(authPayload(), targetDir);
      setRemotePath(data.path);
      setRemoteFiles(data.files || []);
      setSelectedRemoteFile(null);
    } catch (err: any) {
      setRemoteError(err.message);
    } finally {
      setIsLoadingRemote(false);
    }
  };

  useEffect(() => {
    fetchLocalDir();
    fetchRemoteSFTP(remotePath);
  }, []);

  const handleLocalNavigate = (file: FileItem) => {
    if (file.isDir) fetchLocalDir(file.path);
  };

  const handleRemoteNavigate = (file: FileItem) => {
    if (file.isDir) fetchRemoteSFTP(file.path);
  };

  const handleUploadToRemote = async () => {
    if (!selectedLocalFile || selectedLocalFile.isDir || selectedLocalFile.name === '..') return;
    const dest = `${remotePath.replace(/\/$/, '')}/${selectedLocalFile.name}`;
    setTransferStatus(`Uploading ${selectedLocalFile.name}…`);
    try {
      await sftpUpload(authPayload(), selectedLocalFile.path, dest);
      setTransferStatus(`Uploaded ${selectedLocalFile.name}`);
      await fetchRemoteSFTP(remotePath);
    } catch (err: any) {
      setTransferStatus(`Upload failed: ${err.message}`);
    }
  };

  const handleDownloadToLocal = async () => {
    if (!selectedRemoteFile || selectedRemoteFile.isDir || selectedRemoteFile.name === '..') return;
    const dest = `${localPath.replace(/[\\/]$/, '')}${localPath.includes('\\') ? '\\' : '/'}${selectedRemoteFile.name}`;
    setTransferStatus(`Downloading ${selectedRemoteFile.name}…`);
    try {
      await sftpDownload(authPayload(), selectedRemoteFile.path, dest);
      setTransferStatus(`Downloaded ${selectedRemoteFile.name}`);
      await fetchLocalDir(localPath);
    } catch (err: any) {
      setTransferStatus(`Download failed: ${err.message}`);
    }
  };

  const handleOpenChmod = (file: FileItem) => {
    setChmodTargetFile(file);
    setChmodModalOpen(true);
  };

  const handleSavePermissions = async (fileName: string, octal: string, formatted: string) => {
    const file = remoteFiles.find((f) => f.name === fileName);
    if (!file) return;
    try {
      await sftpChmod(authPayload(), file.path, octal);
      setRemoteFiles((prev) =>
        prev.map((f) => (f.name === fileName ? { ...f, numericChmod: octal, permissions: formatted } : f))
      );
      setTransferStatus(`Permissions updated for ${fileName}`);
    } catch (err: any) {
      setTransferStatus(`chmod failed: ${err.message}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const FileTable = ({
    files,
    selected,
    onSelect,
    onNavigate,
    showChmod,
  }: {
    files: FileItem[];
    selected: FileItem | null;
    onSelect: (f: FileItem) => void;
    onNavigate: (f: FileItem) => void;
    showChmod?: boolean;
  }) => (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-left text-[12px] border-collapse">
        <thead>
          <tr style={{ background: 'var(--bg-panel)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <th className="py-2 px-3 font-medium">Name</th>
            <th className="py-2 px-3 font-medium w-24">Size</th>
            {showChmod ? <th className="py-2 px-3 font-medium w-28">Mode</th> : <th className="py-2 px-3 font-medium w-36">Modified</th>}
            {showChmod && <th className="py-2 px-3 font-medium w-10" />}
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const isSelected = selected?.path === file.path;
            return (
              <tr
                key={file.path}
                onClick={() => onSelect(file)}
                onDoubleClick={() => onNavigate(file)}
                className={`cursor-pointer ${isSelected ? 'row-selected' : ''}`}
                style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <td className="py-1.5 px-3">
                  <span className="inline-flex items-center gap-2" style={{ color: 'var(--text)' }}>
                    {file.isDir ? (
                      <Folder className="w-3.5 h-3.5" style={{ color: 'var(--folder)' }} />
                    ) : (
                      <FileText className="w-3.5 h-3.5" style={{ color: 'var(--text-faint)' }} />
                    )}
                    {file.name}
                  </span>
                </td>
                <td className="py-1.5 px-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {formatSize(file.size)}
                </td>
                {showChmod ? (
                  <td className="py-1.5 px-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                    {file.permissions || '—'}
                  </td>
                ) : (
                  <td className="py-1.5 px-3" style={{ color: 'var(--text-muted)' }}>
                    {file.modifiedAt || '—'}
                  </td>
                )}
                {showChmod && (
                  <td className="py-1.5 px-2 text-right">
                    {file.name !== '..' && !file.isDir && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenChmod(file);
                        }}
                        className="btn-icon"
                        style={{ width: 24, height: 24 }}
                        title="Permissions"
                      >
                        <Lock className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full" style={{ background: 'var(--bg-app)', color: 'var(--text)' }}>
      <div className="surface-bar justify-between">
        <div className="flex items-center gap-2 text-[13px] min-w-0">
          <ArrowRightLeft className="w-4 h-4 shrink-0" style={{ color: 'var(--icon)' }} />
          <span className="font-medium" style={{ color: 'var(--text-bright)' }}>
            File transfer
          </span>
          {transferStatus && (
            <span className="truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {transferStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUploadToRemote}
            disabled={!selectedLocalFile || selectedLocalFile.isDir}
            className="btn-ide-primary"
            style={{ height: 28, minHeight: 28 }}
          >
            Upload <ArrowRight className="w-3 h-3" />
          </button>
          <button
            onClick={handleDownloadToLocal}
            disabled={!selectedRemoteFile || selectedRemoteFile.isDir}
            className="btn-ide-secondary"
            style={{ height: 28, minHeight: 28 }}
          >
            <ArrowLeft className="w-3 h-3" /> Download
          </button>
          <button
            onClick={() => {
              fetchLocalDir(localPath || undefined);
              fetchRemoteSFTP(remotePath);
            }}
            className="btn-icon"
            style={{ width: 28, height: 28 }}
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRemote || isLoadingLocal ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex-1 flex flex-col min-w-0" style={{ borderRight: '1px solid var(--border)' }}>
          <div
            className="h-8 px-3 flex items-center gap-2 text-[12px] font-mono truncate"
            style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <HardDrive className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Local · {localPath || '…'}</span>
          </div>
          {localError && (
            <div className="px-3 py-2 text-[12px] flex items-center gap-2" style={{ color: 'var(--danger)', borderBottom: '1px solid var(--border)' }}>
              <AlertCircle className="w-3.5 h-3.5" />
              {localError}
            </div>
          )}
          <FileTable
            files={localFiles}
            selected={selectedLocalFile}
            onSelect={setSelectedLocalFile}
            onNavigate={handleLocalNavigate}
          />
          <div
            className="h-6 px-3 flex items-center text-[11px]"
            style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', color: 'var(--text-faint)' }}
          >
            {localFiles.length} items
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div
            className="h-8 px-3 flex items-center justify-between gap-2 text-[12px] font-mono"
            style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <span className="flex items-center gap-2 truncate">
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Remote · {remotePath}</span>
            </span>
            {isLoadingRemote && <span className="text-[11px]">Loading…</span>}
          </div>
          {remoteError && (
            <div className="px-3 py-2 text-[12px] flex items-center gap-2" style={{ color: 'var(--danger)', borderBottom: '1px solid var(--border)' }}>
              <AlertCircle className="w-3.5 h-3.5" />
              {remoteError}
            </div>
          )}
          <FileTable
            files={remoteFiles}
            selected={selectedRemoteFile}
            onSelect={setSelectedRemoteFile}
            onNavigate={handleRemoteNavigate}
            showChmod
          />
          <div
            className="h-6 px-3 flex items-center text-[11px]"
            style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', color: 'var(--text-faint)' }}
          >
            {remoteFiles.length} items
          </div>
        </div>
      </div>

      <ChmodModal
        isOpen={chmodModalOpen}
        file={chmodTargetFile}
        onClose={() => setChmodModalOpen(false)}
        onSavePermissions={handleSavePermissions}
      />
    </div>
  );
};
