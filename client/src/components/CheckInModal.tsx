import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// Replaces tab-visibility tracking (Decision: click-to-confirm, no
// IdleDetector) — a student can be in another tab the whole focus block and
// never see this except at the two scheduled pings (src/rooms.ts's
// armCheckinTimers, minute 20 and 35). Missing the deadline demotes exactly
// like the old tab_hidden path used to.
export function CheckInModal({ deadlineAt, onConfirm }: { deadlineAt: number; onConfirm: () => void }) {
  const [totalMs] = useState(() => Math.max(1, deadlineAt - Date.now()));
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadlineAt - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingMs(Math.max(0, deadlineAt - Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, [deadlineAt]);

  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      style={{ backdropFilter: "blur(12px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl bg-espresso p-6 text-center text-cream shadow-[var(--shadow-notion-lg)]"
      >
        <h2 className="font-mono text-lg">Still here?</h2>
        <p className="mt-1 text-sm text-cream/70">
          Just a quick check-in — no need to switch back to this tab otherwise.
        </p>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-terracotta transition-[width] duration-1000 ease-linear"
            style={{ width: `${(remainingMs / totalMs) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onConfirm}
          className="mt-4 w-full rounded-md bg-sage px-4 py-2 text-sm font-medium text-espresso"
        >
          I&rsquo;m here{secondsLeft > 0 ? ` (${secondsLeft}s)` : ""}
        </button>
      </motion.div>
    </motion.div>
  );
}
