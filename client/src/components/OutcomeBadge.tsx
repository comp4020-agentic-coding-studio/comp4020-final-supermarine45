import type { TicketStamp } from "../types";

export function OutcomeBadge({ stamp, stayedFullBlock }: { stamp: TicketStamp | null; stayedFullBlock: boolean }) {
  if (stamp === "completed" && stayedFullBlock) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Completed</span>
    );
  }
  if (stamp === "partial") {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Partial</span>;
  }
  return (
    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">Left early</span>
  );
}
