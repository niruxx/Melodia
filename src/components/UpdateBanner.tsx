import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpCircle, Download, X } from "lucide-react";
import { hasUpdateBanner, useUpdateStore } from "../store/updateStore";

/**
 * A one-line strip under the top bar when a newer Melodia has been published.
 *
 * Deliberately the quietest thing that still gets noticed: it doesn't steal
 * focus, doesn't cover anything, and doesn't interrupt playback. Clicking it
 * opens the release notes; the × puts it away until the next launch.
 */
export function UpdateBanner() {
  const show = useUpdateStore(hasUpdateBanner);
  const version = useUpdateStore((s) => s.release?.version);
  const openNotes = useUpdateStore((s) => s.openNotes);
  const dismiss = useUpdateStore((s) => s.dismiss);

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/10 px-6 py-1.5 text-xs">
            <button
              onClick={openNotes}
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-muted transition-colors hover:text-fg"
            >
              <ArrowUpCircle size={14} className="shrink-0 text-accent" />
              <span className="truncate">
                <span className="font-semibold text-fg">Melodia v{version}</span> is available —
                see what&rsquo;s new
              </span>
            </button>
            <button
              onClick={dismiss}
              aria-label="Dismiss until next launch"
              className="shrink-0 text-muted transition-colors hover:text-fg"
            >
              <X size={13} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The release notes, as written on the GitHub release.
 *
 * Mounted at the app root rather than beside the banner: it's a fixed overlay,
 * and the panel it would otherwise live inside clips its own contents.
 */
export function UpdateNotes() {
  const open = useUpdateStore((s) => s.notesOpen);
  const release = useUpdateStore((s) => s.release);
  const close = useUpdateStore((s) => s.closeNotes);
  const skip = useUpdateStore((s) => s.skip);

  return (
    <AnimatePresence>
      {open && release && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-[70] flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-surface-2 shadow-2xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold">{release.name}</h2>
                <p className="text-xs text-muted">
                  v{release.version}
                  {release.isNewer
                    ? ` · you have v${release.currentVersion}`
                    : " · you're on this version"}
                  {release.publishedAt && ` · ${formatDate(release.publishedAt)}`}
                </p>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="shrink-0 text-muted transition-colors hover:text-fg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {release.notes.trim() ? (
                <ReleaseNotes notes={release.notes} />
              ) : (
                <p className="text-sm text-muted">This release came without notes.</p>
              )}
            </div>

            {/* Only an update gets the download and the skip. Read on its own
                — the notes for the version you're already running — this is
                just something to close. */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
              {release.isNewer ? (
                <>
                  <button
                    onClick={skip}
                    className="text-xs text-muted underline transition-colors hover:text-fg"
                  >
                    Skip this version
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={close}
                      className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg"
                    >
                      Later
                    </button>
                    <button
                      onClick={() => void openUrl(release.downloadUrl ?? release.url)}
                      className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                    >
                      <Download size={16} />
                      {release.downloadUrl ? "Download" : "Open release page"}
                    </button>
                  </div>
                  {/* The MSI carries a pinned upgrade code and a major-upgrade
                      rule, so running it replaces this install in place. Saying
                      so is the difference between someone updating now and
                      someone putting it off in case they lose their settings. */}
                  {release.downloadUrl && (
                    <p className="w-full text-right text-[11px] text-muted">
                      Installs over your current version — no need to uninstall first.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => void openUrl(release.url)}
                    className="text-xs text-muted underline transition-colors hover:text-fg"
                  >
                    View on GitHub
                  </button>
                  <button
                    onClick={close}
                    className="rounded-full bg-surface-3 px-5 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-3/70"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Just enough Markdown for a release body: headings and bullets.
 *
 * A parser would be a dependency and a sanitising problem for text fetched off
 * the internet; this renders everything as plain text and only varies how a
 * line is *styled*, so nothing in a release body can become markup.
 */
function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
      {notes.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <h3 key={i} className="mt-2 text-xs font-bold uppercase tracking-wider text-muted">
              {heading[1]}
            </h3>
          );
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 text-fg/90">
              <span className="text-accent">•</span>
              <span className="min-w-0 flex-1">{bullet[1]}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className="text-fg/90">
            {line}
          </p>
        );
      })}
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf())
    ? iso
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
