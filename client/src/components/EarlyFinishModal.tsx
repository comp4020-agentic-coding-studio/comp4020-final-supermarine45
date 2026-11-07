import { motion } from "framer-motion";
import type { Ticket } from "../types";

// Shown mid-focus once a personal-duration ticket's own shorter block has
// elapsed — modeled only on BreakModal's "stamp" card (not its "reflect" or
// "kudos" cards, which are break-wide rituals that don't apply here). The
// table itself is still in focus for everyone else; this is purely this
// user's own early checkout.
export function EarlyFinishModal({
  myTicket,
  onStamp,
  onDismiss,
}: {
  myTicket: Ticket | null;
  onStamp: (stamp: "completed" | "partial" | "pivoted") => void;
  onDismiss: () => void;
}) {
  const durationMin = myTicket?.personalDurationMs != null ? Math.round(myTicket.personalDurationMs / 60_000) : null;

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
        className="w-full max-w-md rounded-2xl bg-espresso p-6 text-cream shadow-[var(--shadow-notion-lg)]"
      >
        <h2 className="font-mono text-lg">
          Your {durationMin ?? ""}m block is up
        </h2>
        <p className="mt-1 text-sm text-cream/70">"{myTicket?.body ?? "—"}"</p>
        <p className="mt-2 text-xs text-cream/50">
          The table keeps going without you &mdash; check off your ticket now, or keep working.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onStamp("completed")}
            className="flex-1 rounded-md bg-sage px-4 py-2 text-sm font-medium text-espresso"
          >
            Completed it
          </button>
          <button
            type="button"
            onClick={() => onStamp("partial")}
            className="flex-1 rounded-md border border-white/20 px-4 py-2 text-sm font-medium"
          >
            Partial progress
          </button>
        </div>
        {myTicket?.pivotedAt != null && (
          <button
            type="button"
            onClick={() => onStamp("pivoted")}
            className="mt-2 w-full rounded-md border border-violet-400/40 bg-violet-400/10 px-4 py-2 text-sm font-medium text-violet-300"
          >
            Pivoted &mdash; finished the new goal
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 w-full text-center text-xs text-cream/50 underline underline-offset-2 hover:text-cream/80"
        >
          Keep working
        </button>
      </motion.div>
    </motion.div>
  );
}
