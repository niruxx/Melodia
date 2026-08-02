import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { AppIcon } from "./AppIcon";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between bg-black pl-3"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-xs font-semibold text-muted">
        <AppIcon className="h-4 w-4 rounded-sm" />
        TuneBox
      </div>

      <div className="flex h-full items-stretch">
        <button
          onClick={() => appWindow.minimize()}
          className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Copy size={12} className="-scale-x-100" /> : <Square size={12} />}
        </button>
        <button
          onClick={() => appWindow.close()}
          className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-red-600 hover:text-white"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
