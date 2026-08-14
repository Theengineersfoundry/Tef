import React, { useState, useEffect } from 'react';
import { X, Lock, Check as CheckIcon } from 'lucide-react';
import type { FileItem } from '../types/terminal';

interface ChmodModalProps {
  isOpen: boolean;
  file: FileItem | null;
  onClose: () => void;
  onSavePermissions: (fileName: string, octal: string, formatted: string) => void;
}

export const ChmodModal: React.FC<ChmodModalProps> = ({
  isOpen,
  file,
  onClose,
  onSavePermissions,
}) => {
  const [ownerRead, setOwnerRead] = useState(true);
  const [ownerWrite, setOwnerWrite] = useState(true);
  const [ownerExec, setOwnerExec] = useState(true);
  const [groupRead, setGroupRead] = useState(true);
  const [groupWrite, setGroupWrite] = useState(false);
  const [groupExec, setGroupExec] = useState(true);
  const [otherRead, setOtherRead] = useState(true);
  const [otherWrite, setOtherWrite] = useState(false);
  const [otherExec, setOtherExec] = useState(true);

  useEffect(() => {
    if (file?.numericChmod && file.numericChmod.length === 3) {
      const o = parseInt(file.numericChmod[0], 10);
      const g = parseInt(file.numericChmod[1], 10);
      const w = parseInt(file.numericChmod[2], 10);
      setOwnerRead((o & 4) !== 0);
      setOwnerWrite((o & 2) !== 0);
      setOwnerExec((o & 1) !== 0);
      setGroupRead((g & 4) !== 0);
      setGroupWrite((g & 2) !== 0);
      setGroupExec((g & 1) !== 0);
      setOtherRead((w & 4) !== 0);
      setOtherWrite((w & 2) !== 0);
      setOtherExec((w & 1) !== 0);
    }
  }, [file]);

  if (!isOpen || !file) return null;

  const bit = (r: boolean, w: boolean, x: boolean) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0);
  const octalString = `${bit(ownerRead, ownerWrite, ownerExec)}${bit(groupRead, groupWrite, groupExec)}${bit(otherRead, otherWrite, otherExec)}`;
  const formatPermissionsString = () => {
    const flag = (r: boolean, w: boolean, x: boolean) => `${r ? 'r' : '-'}${w ? 'w' : '-'}${x ? 'x' : '-'}`;
    return `${file.isDir ? 'd' : '-'}${flag(ownerRead, ownerWrite, ownerExec)}${flag(groupRead, groupWrite, groupExec)}${flag(otherRead, otherWrite, otherExec)}`;
  };

  const handleApplyPreset = (preset: '755' | '644' | '777' | '700') => {
    const map: Record<string, [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = {
      '755': [true, true, true, true, false, true, true, false, true],
      '644': [true, true, false, true, false, false, true, false, false],
      '777': [true, true, true, true, true, true, true, true, true],
      '700': [true, true, true, false, false, false, false, false, false],
    };
    const [or, ow, ox, gr, gw, gx, tr, tw, tx] = map[preset];
    setOwnerRead(or); setOwnerWrite(ow); setOwnerExec(ox);
    setGroupRead(gr); setGroupWrite(gw); setGroupExec(gx);
    setOtherRead(tr); setOtherWrite(tw); setOtherExec(tx);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSavePermissions(file.name, octalString, formatPermissionsString());
    onClose();
  };

  const Check = ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
  }) => (
    <label className="flex justify-center items-center gap-1 cursor-pointer" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal-card max-w-md">
        <div className="modal-header">
          <div className="flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 mt-0.5" style={{ color: 'var(--icon)' }} />
            <div>
              <h2 className="font-semibold text-[15px]" style={{ color: 'var(--text-bright)' }}>
                Permissions
              </h2>
              <p className="text-[12px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                {file.name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ width: 32, padding: 0 }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div>
            <label className="field-label">Presets</label>
            <div className="grid grid-cols-4 gap-2">
              {(['755', '644', '700', '777'] as const).map((p) => (
                <button key={p} type="button" onClick={() => handleApplyPreset(p)} className="btn-ide-secondary font-mono text-[12px]">
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-md text-[12px] font-mono space-y-2" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
            <div className="grid grid-cols-4 gap-2 pb-2" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <span />
              <span className="text-center">Read</span>
              <span className="text-center">Write</span>
              <span className="text-center">Exec</span>
            </div>
            {[
              ['Owner', ownerRead, setOwnerRead, ownerWrite, setOwnerWrite, ownerExec, setOwnerExec],
              ['Group', groupRead, setGroupRead, groupWrite, setGroupWrite, groupExec, setGroupExec],
              ['Other', otherRead, setOtherRead, otherWrite, setOtherWrite, otherExec, setOtherExec],
            ].map(([label, r, sr, w, sw, x, sx]) => (
              <div key={label as string} className="grid grid-cols-4 gap-2 items-center">
                <span style={{ color: 'var(--text)' }}>{label as string}</span>
                <Check checked={r as boolean} onChange={sr as (v: boolean) => void} label="read" />
                <Check checked={w as boolean} onChange={sw as (v: boolean) => void} label="write" />
                <Check checked={x as boolean} onChange={sx as (v: boolean) => void} label="exec" />
              </div>
            ))}
          </div>

          <div
            className="flex items-center justify-between px-3 py-2 rounded-md text-[12px] font-mono"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>
              Octal <strong style={{ color: 'var(--text-bright)' }}>{octalString}</strong>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {formatPermissionsString()}
            </span>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-ide-secondary">Cancel</button>
            <button type="submit" className="btn-ide-primary">
              <CheckIcon className="w-3.5 h-3.5" />
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
