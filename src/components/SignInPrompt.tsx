import { Music2 } from "lucide-react";
import { useAuthStore } from "../store/authStore";

type SignInPromptProps = {
  title?: string;
  message?: string;
};

export function SignInPrompt({
  title = "Connect your YouTube Music account",
  message = "Sign in with Google to load your real playlists, library, and recently played.",
}: SignInPromptProps) {
  const openModal = useAuthStore((s) => s.openModal);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="brand-mark flex h-16 w-16 items-center justify-center rounded-2xl text-white">
        <Music2 size={30} />
      </div>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      <button
        onClick={openModal}
        className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
      >
        Connect YouTube Music
      </button>
    </div>
  );
}
