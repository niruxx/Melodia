import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { usePlayerStore } from "../store/playerStore";
import { toast } from "../store/toastStore";

const TEMPLATE_KEY = "melodia:organize-template";

const PRESETS: readonly { label: string; template: string }[] = [
  { label: "Artist / Album", template: "{albumartist}/{album}/{track} - {title}" },
  { label: "Artist / Year - Album", template: "{albumartist}/{year} - {album}/{track} - {title}" },
  { label: "Genre / Artist / Year - Album", template: "{genre}/{albumartist}/{year} - {album}/{track} - {title}" },
];

const FIELDS = "{title} {artist} {albumartist} {album} {genre} {composer} {year} {track} {disc}";

/** How many planned moves the preview lists before summarising the rest. */
const PREVIEW_ROWS = 200;

type Move = { from: string; to: string };
type Plan = { moves: Move[]; unchanged: number };
type Report = { moved: Move[]; failed: string[] };

function readTemplate(): string {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || PRESETS[1].template;
  } catch {
    return PRESETS[1].template;
  }
}

/**
 * Renames and moves local files into a folder layout built from their tags.
 * Always previewed first, and always undoable — this touches the user's own
 * files, so nothing here happens on a single click.
 */
export function OrganizeSettings() {
  const folder = useLocalLibraryStore((s) => s.folder);
  const rescan = useLocalLibraryStore((s) => s.scan);
  const remapTrackIds = usePlayerStore((s) => s.remapTrackIds);

  const [template, setTemplate] = useState(readTemplate);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    invoke<boolean>("organize_can_undo").then(setCanUndo).catch(() => setCanUndo(false));
  }, []);

  // A preview describes one template; editing it makes the preview a lie.
  function changeTemplate(value: string) {
    setTemplate(value);
    setPlan(null);
    setConfirming(false);
    setError(null);
    try {
      localStorage.setItem(TEMPLATE_KEY, value);
    } catch {
      // not persisting is fine
    }
  }

  const relative = (path: string) =>
    folder && path.startsWith(folder) ? path.slice(folder.length).replace(/^[\\/]/, "") : path;

  async function preview() {
    setBusy(true);
    setError(null);
    setConfirming(false);
    try {
      setPlan(await invoke<Plan>("organize_preview", { template }));
    } catch (e) {
      setPlan(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(report: Report, verb: string) {
    const mapping: Record<string, string> = {};
    for (const m of report.moved) mapping[`local:${m.from}`] = `local:${m.to}`;
    remapTrackIds(mapping);
    await rescan();
    setPlan(null);
    setConfirming(false);
    setCanUndo(await invoke<boolean>("organize_can_undo").catch(() => false));

    if (report.failed.length > 0) {
      setError(report.failed.slice(0, 5).join("\n") + (report.failed.length > 5 ? "\n…" : ""));
      toast.error(`${verb} ${report.moved.length} files; ${report.failed.length} couldn't be moved.`);
    } else {
      toast.success(`${verb} ${report.moved.length} files.`);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await finish(await invoke<Report>("organize_apply", { template }), "Organized");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await finish(await invoke<Report>("organize_undo"), "Moved back");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!folder) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="text-sm font-semibold">Organize files</div>
      <div className="text-xs text-muted">
        Renames and moves the files in your music folder to match their tags. Lyrics files move
        with their tracks, emptied folders are removed, and the last run can be undone.
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => changeTemplate(p.template)}
            className={clsx(
              "pill px-2.5 py-1 text-[11px] font-semibold transition-colors",
              template === p.template ? "bg-fg text-black" : "bg-surface-3 text-fg hover:bg-surface-3/70",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        value={template}
        onChange={(e) => changeTemplate(e.target.value)}
        spellCheck={false}
        className="rounded-md bg-surface-3 px-3 py-2 font-mono text-xs text-fg outline-none focus:ring-1 focus:ring-accent"
        aria-label="Folder template"
      />
      <div className="font-mono text-[10px] text-muted">{FIELDS}</div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void preview()}
          disabled={busy}
          className="rounded-full bg-surface-3 px-4 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-3/70 disabled:opacity-50"
        >
          Preview
        </button>
        {plan && plan.moves.length > 0 && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          >
            Organize {plan.moves.length} files…
          </button>
        )}
        {confirming && plan && (
          <>
            <button
              onClick={() => void apply()}
              disabled={busy}
              className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Moving…" : `Move ${plan.moves.length} files`}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="text-xs text-muted hover:text-fg"
            >
              Cancel
            </button>
          </>
        )}
        {canUndo && !confirming && (
          <button
            onClick={() => void undo()}
            disabled={busy}
            className="ml-auto text-xs text-muted hover:text-fg disabled:opacity-50"
          >
            Undo last organize
          </button>
        )}
      </div>

      {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}

      {plan && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-3 p-2">
          <div className="text-xs text-muted">
            {plan.moves.length === 0
              ? `Everything is already in place (${plan.unchanged} files).`
              : `${plan.moves.length} to move · ${plan.unchanged} already in place`}
          </div>
          {plan.moves.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              {plan.moves.slice(0, PREVIEW_ROWS).map((m) => (
                <div key={m.from} className="border-t border-border/40 py-1 font-mono text-[10px] leading-snug">
                  <div className="truncate text-muted" title={m.from}>
                    {relative(m.from)}
                  </div>
                  <div className="truncate text-fg" title={m.to}>
                    → {relative(m.to)}
                  </div>
                </div>
              ))}
              {plan.moves.length > PREVIEW_ROWS && (
                <div className="py-1 text-[10px] text-muted">
                  …and {plan.moves.length - PREVIEW_ROWS} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
