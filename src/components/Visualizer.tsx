import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { useVisualizerStore } from "../store/visualizerStore";

/** Must match `BAND_COUNT` in `src-tauri/src/analyzer.rs`. */
const BAND_COUNT = 32;

/**
 * Real-time spectrum bars driven by the Rust FFT thread.
 *
 * Spectrum frames arrive ~30x/second. They're written to a ref and painted on
 * rAF rather than pushed through zustand — routing them through React state
 * would re-render the whole subtree 30 times a second for a purely visual effect.
 */
type VisualizerProps = {
  className?: string;
  /** "mirror" grows bars from the centre line; "bars" sits them on the floor. */
  variant?: "bars" | "mirror";
};

/** How far each bar moves toward its new value per frame. Raw spectrum frames
 * arrive ~30x/second and land in visible steps; easing hides the staircase. */
const SMOOTHING = 0.28;

export function Visualizer({ className, variant = "bars" }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandsRef = useRef<number[]>(new Array(BAND_COUNT).fill(0));
  const smoothedRef = useRef<number[]>(new Array(BAND_COUNT).fill(0));
  const variantRef = useRef(variant);
  variantRef.current = variant;

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
      const smoothed = smoothedRef.current;
      const mirror = variantRef.current === "mirror";
      const gap = 2;
      const barWidth = Math.max(1, (w - gap * (bands.length - 1)) / bands.length);

      // Pulled from the store rather than React state: this runs ~60x/second,
      // and a fixed theme should override the artwork palette without the
      // draw loop having to be torn down and rebuilt on every change.
      const themed = useVisualizerStore.getState().activeColors();
      const c1 = themed?.[0] ?? (styles.getPropertyValue("--accent-dynamic-1").trim() || "#7c5cff");
      const c2 = themed?.[1] ?? (styles.getPropertyValue("--accent-dynamic-2").trim() || "#ec4899");
      const gradient = mirror
        ? ctx.createLinearGradient(0, h, 0, 0)
        : ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, c1);
      gradient.addColorStop(1, c2);

      const r = Math.min(barWidth / 2, 3);

      // Two passes: a wider, faint copy underneath reads as a glow. Cheaper
      // than canvas shadowBlur, which is costly to run at 60fps.
      for (const pass of [0, 1]) {
        const isGlow = pass === 0;
        ctx.globalAlpha = isGlow ? 0.28 : 1;
        ctx.fillStyle = gradient;
        const spread = isGlow ? 2 : 0;

        for (let i = 0; i < bands.length; i++) {
          // Always show a sliver so the visualiser reads as "idle" rather
          // than "broken" when nothing is playing.
          const target = Math.max(0.015, bands[i] ?? 0);
          if (isGlow) {
            smoothed[i] = smoothed[i] + (target - smoothed[i]) * SMOOTHING;
          }
          const value = Math.max(0.015, smoothed[i]);
          const x = i * (barWidth + gap) - spread / 2;
          const width = barWidth + spread;

          if (mirror) {
            // Half the height each way so a full-scale band still fits.
            const half = (value * h) / 2;
            const cap = Math.min(width / 2, 3);
            ctx.beginPath();
            ctx.roundRect(x, h / 2 - half, width, half * 2, cap);
            ctx.fill();
          } else {
            const barHeight = value * h;
            ctx.beginPath();
            ctx.roundRect(x, h - barHeight, width, barHeight, [r, r, 0, 0]);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

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
