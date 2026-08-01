import { create } from "zustand";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "./toastStore";

const MINI_WIDTH = 380;
const MINI_HEIGHT = 150;

type MiniPlayerStore = {
  active: boolean;
  toggle: () => Promise<void>;
};

/** Size to restore when leaving mini mode, captured on the way in. */
let previousSize: { width: number; height: number } | null = null;

export const useMiniPlayerStore = create<MiniPlayerStore>((set, get) => ({
  active: false,

  toggle: async () => {
    const win = getCurrentWindow();
    const goingMini = !get().active;

    try {
      if (goingMini) {
        const size = await win.innerSize();
        const scale = await win.scaleFactor();
        const logical = size.toLogical(scale);
        previousSize = { width: logical.width, height: logical.height };

        await win.setResizable(false);
        await win.setSize(new LogicalSize(MINI_WIDTH, MINI_HEIGHT));
        await win.setAlwaysOnTop(true);
        set({ active: true });
      } else {
        await win.setAlwaysOnTop(false);
        await win.setResizable(true);
        if (previousSize) {
          await win.setSize(new LogicalSize(previousSize.width, previousSize.height));
        }
        await win.center();
        set({ active: false });
      }
    } catch (e) {
      // Leave `active` untouched so the UI never claims a mode the window
      // isn't actually in.
      toast.error(`Couldn't switch player mode: ${e}`);
    }
  },
}));
