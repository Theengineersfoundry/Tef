import React, { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const WindowControls: React.FC = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.isMaximized().then(setMaximized).catch(() => undefined);
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <div className="window-controls" aria-label="Window controls" data-tauri-drag-region="false">
      <button
        type="button"
        className="window-control-btn"
        title="Minimize"
        onClick={() => void win().minimize()}
      >
        <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="window-control-btn"
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void win().toggleMaximize()}
      >
        {maximized ? (
          <span className="window-restore-icon" aria-hidden />
        ) : (
          <Square className="w-3 h-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        className="window-control-btn is-close"
        title="Close"
        onClick={() => void win().close()}
      >
        <X className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
};
