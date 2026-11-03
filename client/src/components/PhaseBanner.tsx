import { AnimatePresence, motion } from "framer-motion";
import type { Subphase, TimerPayload } from "../types";
import { SplitFlapTimer } from "./SplitFlapTimer";

// The Kickoff window is the first proportional slice of every mode's focus
// block (including Silent, whose subphase is always null) — a client-only
// label (Decision 5), not a server subphase. Computed as a fraction of
// durationMs, like splitMsFor, so it still lands correctly under a
// shortened test-speed cycle instead of staying pinned to a real 2-minute mark.
function label(status: TimerPayload["status"], subphase: Subphase, elapsedMs: number, durationMs: number | null): string {
  if (status === "idle") return "Waiting for the next cycle";
  if (status === "break") return "Break";
  if (status === "focus" && durationMs !== null && elapsedMs < durationMs * (2 / 50)) return "Kickoff";
  if (subphase === "collab") return "Open Collab";
  if (subphase === "solo") return "Solo Gate";
  return "Focus";
}

export function PhaseBanner({ timer, now }: { timer: TimerPayload; now: number }) {
  const remainingMs = timer.phaseEndAt ? Math.max(0, timer.phaseEndAt - now) : 0;
  const elapsedMs = timer.durationMs !== null ? timer.durationMs - remainingMs : 0;
  const minutes = Math.ceil(remainingMs / 60_000);
  const isCollab = timer.subphase === "collab";
  const isBreak = timer.status === "break";
  const currentLabel = label(timer.status, timer.subphase, elapsedMs, timer.durationMs);

  const bg = isBreak ? "bg-espresso" : timer.status === "focus" ? "bg-oled" : "bg-charcoal";
  const accent = isBreak ? "text-terracotta" : isCollab ? "text-sage" : "text-amber";

  return (
    <motion.div
      animate={{ backgroundColor: isBreak ? "#1c1917" : timer.status === "focus" ? "#000000" : "#1f1d1a" }}
      transition={{ duration: 0.8 }}
      className={`relative overflow-hidden rounded-xl p-8 text-center ${bg}`}
    >
      <AnimatePresence mode="wait">
        <motion.p
          key={currentLabel}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className={`font-mono text-sm uppercase tracking-widest ${accent}`}
        >
          {currentLabel}
        </motion.p>
      </AnimatePresence>
      {timer.status !== "idle" ? (
        <SplitFlapTimer minutes={minutes} className={`mt-3 justify-center text-6xl ${accent}`} />
      ) : (
        <p className="mt-3 text-4xl text-white/40">—</p>
      )}
      {timer.status === "focus" && (
        <p className="mt-2 text-xs text-white/50">
          {isCollab ? "Talk, swap screens, swarm the stuck ones." : "Heads down. No talking yet."}
        </p>
      )}
    </motion.div>
  );
}
