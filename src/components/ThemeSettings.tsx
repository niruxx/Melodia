import clsx from "clsx";
import { RotateCcw } from "lucide-react";
import {
  GRADIENT_INTENSITIES,
  UI_THEMES,
  useUiThemeStore,
  type UiTheme,
} from "../store/uiThemeStore";
import {
  CUSTOM_THEME_ID,
  VISUALIZER_THEMES,
  useVisualizerStore,
  type VisualizerTheme,
} from "../store/visualizerStore";

/** Mirrors the canvas gradient, which runs bottom-to-top. */
function swatchGradient(theme: VisualizerTheme): string {
  return theme.colors
    ? `linear-gradient(to top, ${theme.colors[0]}, ${theme.colors[1]})`
    : "linear-gradient(to top, var(--accent-dynamic-1), var(--accent-dynamic-2))";
}

/** A miniature of the app: page, panel and accent, in that theme's colours. */
function ThemePreview({ theme }: { theme: UiTheme }) {
  const c = theme.colors;
  return (
    <span
      className="flex h-10 w-full items-end gap-1 rounded p-1"
      style={{ backgroundColor: c.base, border: `1px solid ${c.border}` }}
    >
      <span className="h-full w-1/3 rounded-sm" style={{ backgroundColor: c.black }} />
      <span className="h-2/3 flex-1 rounded-sm" style={{ backgroundColor: c.surface2 }} />
      <span
        className="h-3 w-3 shrink-0 self-center rounded-full"
        style={{ backgroundImage: `linear-gradient(135deg, ${c.accent}, ${c.accent2})` }}
      />
    </span>
  );
}

export function ThemeSettings() {
  const themeId = useUiThemeStore((s) => s.themeId);
  const setTheme = useUiThemeStore((s) => s.setTheme);
  const accent = useUiThemeStore((s) => s.accent);
  const setAccent = useUiThemeStore((s) => s.setAccent);
  const resetAccent = useUiThemeStore((s) => s.resetAccent);
  const colors = useUiThemeStore((s) => s.colors());
  const gradient = useUiThemeStore((s) => s.gradient);
  const setGradient = useUiThemeStore((s) => s.setGradient);

  const visualizerThemeId = useVisualizerStore((s) => s.themeId);
  const visualizerCustom = useVisualizerStore((s) => s.custom);
  const setVisualizerTheme = useVisualizerStore((s) => s.setTheme);
  const setVisualizerCustomColor = useVisualizerStore((s) => s.setCustomColor);

  return (
    <div className="flex flex-col gap-5 rounded-lg bg-surface-3/30 p-3">
      <div className="text-sm font-bold">Theme</div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">App colours</div>
        <div className="text-xs text-muted">Repaints the whole interface.</div>
        <div className="grid grid-cols-3 gap-2">
          {UI_THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              aria-pressed={themeId === theme.id}
              className={clsx(
                "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
                themeId === theme.id
                  ? "border-accent bg-surface-3"
                  : "border-transparent bg-surface-3/40 hover:bg-surface-3",
              )}
            >
              <ThemePreview theme={theme} />
              <span className="text-[10px] font-semibold text-fg">{theme.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Accent</div>
          {accent && (
            <button
              onClick={resetAccent}
              className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-fg"
            >
              <RotateCcw size={11} />
              Use theme default
            </button>
          )}
        </div>
        <div className="text-xs text-muted">
          Buttons, highlights and the brand mark. Kept when you switch themes.
        </div>
        <div className="flex items-center gap-4 rounded-lg bg-surface-3 px-3 py-2">
          {([0, 1] as const).map((i) => (
            <label key={i} className="flex items-center gap-2 text-xs text-muted">
              <input
                type="color"
                value={i === 0 ? colors.accent : colors.accent2}
                onChange={(e) => setAccent(i, e.target.value)}
                className="h-7 w-9 cursor-pointer rounded bg-transparent p-0"
                aria-label={i === 0 ? "Primary accent" : "Secondary accent"}
              />
              {i === 0 ? "Primary" : "Secondary"}
            </label>
          ))}
          <span
            className="ml-auto h-7 w-16 rounded-full"
            style={{
              backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accent2})`,
            }}
            aria-hidden
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Background wash</div>
        <div className="text-xs text-muted">
          A soft gradient behind the library that drifts with the current track's artwork.
        </div>
        <div className="flex gap-2">
          {GRADIENT_INTENSITIES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGradient(g.id)}
              className={clsx(
                "pill flex-1 px-3 py-1.5 text-xs font-semibold transition-colors",
                gradient === g.id
                  ? "bg-fg text-black"
                  : "bg-surface-3 text-fg hover:bg-surface-3/70",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Visualizer colours</div>
        <div className="text-xs text-muted">
          Pick a palette for the spectrum bars, or let them keep following the album artwork.
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            ...VISUALIZER_THEMES,
            // The custom entry previews whatever pair is currently saved.
            { id: CUSTOM_THEME_ID, label: "Custom", colors: visualizerCustom },
          ].map((theme) => (
            <button
              key={theme.id}
              onClick={() => setVisualizerTheme(theme.id)}
              aria-pressed={visualizerThemeId === theme.id}
              className={clsx(
                "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
                visualizerThemeId === theme.id
                  ? "border-accent bg-surface-3"
                  : "border-transparent bg-surface-3/40 hover:bg-surface-3",
              )}
            >
              <span
                className="h-8 w-full rounded"
                style={{ backgroundImage: swatchGradient(theme) }}
              />
              <span className="text-[10px] font-semibold text-fg">{theme.label}</span>
            </button>
          ))}
        </div>

        {visualizerThemeId === CUSTOM_THEME_ID && (
          <div className="flex items-center gap-4 rounded-lg bg-surface-3 px-3 py-2">
            {([0, 1] as const).map((i) => (
              <label key={i} className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="color"
                  value={visualizerCustom[i]}
                  onChange={(e) => setVisualizerCustomColor(i, e.target.value)}
                  className="h-7 w-9 cursor-pointer rounded bg-transparent p-0"
                  aria-label={i === 0 ? "Bottom bar colour" : "Top bar colour"}
                />
                {i === 0 ? "Bottom" : "Top"}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
