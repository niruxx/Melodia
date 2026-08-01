import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useLibraryStore } from "../store/libraryStore";
import { usePlaylistModalStore } from "../store/playlistModalStore";
import { toast } from "../store/toastStore";
import type { PlaylistPrivacy } from "../lib/types";

const privacyOptions: { value: PlaylistPrivacy; label: string; hint: string }[] = [
  { value: "PRIVATE", label: "Private", hint: "Only you can see it" },
  { value: "UNLISTED", label: "Unlisted", hint: "Anyone with the link" },
  { value: "PUBLIC", label: "Public", hint: "Anyone can find it" },
];

/** Create-a-playlist and edit-details share one form; `form.mode` picks the copy. */
export function PlaylistFormModal() {
  const form = usePlaylistModalStore((s) => s.form);
  const close = usePlaylistModalStore((s) => s.closeForm);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const editPlaylist = useLibraryStore((s) => s.editPlaylist);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>("PRIVATE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time the modal opens so an edit shows current values and a
  // create starts blank, rather than whatever the last session left behind.
  useEffect(() => {
    if (!form) return;
    setError(null);
    setSaving(false);
    if (form.mode === "edit") {
      setTitle(form.collection.title);
      setDescription(form.collection.description ?? "");
      setPrivacy(form.collection.privacy ?? "PRIVATE");
    } else {
      setTitle("");
      setDescription("");
      setPrivacy("PRIVATE");
    }
  }, [form]);

  const isEdit = form?.mode === "edit";
  const seedCount = form?.mode === "create" ? form.tracks.length : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;

    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the playlist a name.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (form.mode === "edit") {
        await editPlaylist(form.collection.id, { title: trimmed, description, privacy });
        toast.success("Playlist updated");
      } else {
        const id = await createPlaylist(trimmed, description, privacy);
        if (form.tracks.length > 0) {
          await addTracksToPlaylist(id, form.tracks);
        }
        toast.success(
          form.tracks.length > 0
            ? `Created "${trimmed}" with ${form.tracks.length} song${form.tracks.length === 1 ? "" : "s"}`
            : `Created "${trimmed}"`,
        );
      }
      close();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {form && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-50 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            <button
              onClick={close}
              className="absolute right-4 top-4 text-muted hover:text-fg"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-bold">{isEdit ? "Edit details" : "New playlist"}</h2>
            {seedCount > 0 && (
              <p className="mt-1 text-sm text-muted">
                {seedCount} song{seedCount === 1 ? "" : "s"} will be added once it's created.
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Name</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  maxLength={150}
                  placeholder="My playlist"
                  className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Optional"
                  className="resize-none rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                />
              </label>

              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Visibility</span>
                <div className="flex gap-2">
                  {privacyOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPrivacy(option.value)}
                      title={option.hint}
                      className={
                        privacy === option.value
                          ? "pill flex-1 bg-fg px-3 py-1.5 text-xs font-semibold text-black"
                          : "pill flex-1 bg-surface-3 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface"
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {isEdit ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
