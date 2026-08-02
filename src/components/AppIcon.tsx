import clsx from "clsx";
import iconUrl from "../assets/icon.png";

/**
 * The real application icon, the same artwork `src-tauri/icons` ships as the
 * window and taskbar icon.
 *
 * Distinct from the `.brand-mark` gradient, which is still the right choice
 * for decorative tiles that stand in for artwork (Liked Songs, Recently
 * Played) rather than identifying the app.
 */
export function AppIcon({ className }: { className?: string }) {
  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className={clsx("select-none object-contain", className)}
    />
  );
}
