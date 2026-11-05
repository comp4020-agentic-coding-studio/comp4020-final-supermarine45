import { useEffect } from "react";
import { usePictureInPicture, isPipSupported } from "../hooks/usePictureInPicture";
import { ringColor } from "./TableDashboard";
import type { TimerPayload } from "../types";

const CANVAS_SIZE = 240;

// Minutes only, no ticking seconds (CLAUDE.md §4) — redrawn on the same 1s
// tick useNow() already provides to the rest of the page, not
// requestAnimationFrame, so the floating widget stays as calm as the banner
// it mirrors.
function draw(canvas: HTMLCanvasElement, timer: TimerPayload, now: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = CANVAS_SIZE;
  const center = size / 2;
  const radius = size * 0.38;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);

  const remainingMs = timer.phaseEndAt ? Math.max(0, timer.phaseEndAt - now) : 0;
  const elapsedFraction = timer.durationMs ? 1 - remainingMs / timer.durationMs : 0;
  const color = ringColor(timer);

  ctx.lineWidth = size * 0.045;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, elapsedFraction)));
  ctx.stroke();

  const minutes = Math.ceil(remainingMs / 60_000);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${size * 0.26}px "JetBrains Mono", "SF Mono", monospace`;
  ctx.fillText(timer.status === "idle" ? "—" : `${minutes}m`, center, center);
}

export function PipTimerButton({ timer, now }: { timer: TimerPayload; now: number }) {
  const { canvasRef, videoRef, isActive, toggle } = usePictureInPicture();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, timer, now);
  }, [canvasRef, timer, now]);

  if (!isPipSupported()) return null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white"
      >
        {isActive ? "Close floating timer" : "Pop out timer"}
      </button>
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="hidden" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- silent, captionless by nature: a canvas-driven countdown, not real video content */}
      <video ref={videoRef} muted playsInline className="hidden" />
    </>
  );
}
