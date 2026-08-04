import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import clsx from "clsx";
import { AppIcon } from "./AppIcon";
import { useUiThemeStore } from "../store/uiThemeStore";
import { useWallpaperStore } from "../store/wallpaperStore";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const washTitlebar = useUiThemeStore((s) => s.washTitlebar);
  const wallpaper = useWallpaperStore((s) => s.enabled);

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
      className={clsx(
        "flex h-8 shrink-0 select-none items-center justify-between pl-3",
        // The album-art tint, opt-in from Theme → Background wash. Paints only
        // a `background-image`, so the bar keeps its own base colour under it.
        washTitlebar && "chrome-bar-top",
        // Matches the sidebar: sheer enough for the wallpaper to read through,
        // otherwise a black band would sit across the top of the artwork.
        wallpaper ? "bg-black/70" : "bg-black",
      )}
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-xs font-semibold text-muted">
        <AppIcon className="h-4 w-4 rounded-sm" />
        Melodia
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
