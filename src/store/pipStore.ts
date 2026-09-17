import { create } from "zustand";
import { toast } from "./toastStore";

type PipStore = {
  /** False on webviews without the Document/Video PiP API and canvas capture
   * (WKWebView on macOS, WebKitGTK on Linux) — Chromium-based WebView2 on
   * Windows is the tested case. */
  supported: boolean;
  active: boolean;
  /** Set by `PictureInPictureSource`, the component that actually owns the
   * hidden video element PiP is requested on. */
  requestToggle: (() => void) | null;
  setSupported: (value: boolean) => void;
  setActive: (value: boolean) => void;
  setRequestToggle: (fn: (() => void) | null) => void;
  toggle: () => void;
};

export const usePipStore = create<PipStore>((set, get) => ({
  supported: false,
  active: false,
  requestToggle: null,

  setSupported: (value) => set({ supported: value }),
  setActive: (value) => set({ active: value }),
  setRequestToggle: (fn) => set({ requestToggle: fn }),

  toggle: () => {
    const fn = get().requestToggle;
    if (!fn) {
      toast.error("Picture-in-picture isn't available in this window.");
      return;
    }
    fn();
  },
}));
