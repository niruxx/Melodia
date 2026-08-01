import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";

/** Must match `BAND_COUNT` in `src-tauri/src/analyzer.rs`. */
const BAND_COUNT = 32;

/**
 * Real-time spectrum bars driven by the Rust FFT thread.
 *
 * Spectrum frames arrive ~30x/second. They're written to a ref and painted on
 * rAF rather than pushed through zustand — routing them through React state
 * would re-render the whole subtree 30 times a second for a purely visual effect.
 */
export function Visualizer({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandsRef = useRef<number[]>(new Array(BAND_COUNT).fill(0));

  useEffect(() => {
    const unlisten = listen<number[]>("playback:spectrum", (event) => {
      bandsRef.current = event.payload;
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Read the live theme colours each frame so the bars re-tint along with
    // the rest of the UI when the track (and therefore the palette) changes.
    const styles = getComputedStyle(document.documentElement);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const bands = bandsRef.current;
      const gap = 2;
      const barWidth = Math.max(1, (w - gap * (bands.length - 1)) / bands.length);

      const c1 = styles.getPropertyValue("--accent-dynamic-1").trim() || "#7c5cff";
      const c2 = styles.getPropertyValue("--accent-dynamic-2").trim() || "#ec4899";
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, c1);
      gradient.addColorStop(1, c2);
      ctx.fillStyle = gradient;

      for (let i = 0; i < bands.length; i++) {
        // Always show a sliver so the visualiser reads as "idle" rather than
        // "broken" when nothing is playing.
        const value = Math.max(0.015, bands[i] ?? 0);
        const barHeight = value * h;
        const x = i * (barWidth + gap);
        const y = h - barHeight;
        const r = Math.min(barWidth / 2, 3);

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [r, r, 0, 0]);
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // The sizing className goes on a wrapper, not the canvas: putting it on the
  // canvas alongside `h-full` lets the two height utilities collide and the
  // canvas escape its intended box.
  return (
    <div className={clsx("overflow-hidden", className)}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
    </div>
  );
}
