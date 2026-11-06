import type { Ticket } from "../types";

// Visible to the whole table, not Leader-gated — matches today's Stuck flag
// visibility. Ordering is purely by stuckAt ascending: whoever has been stuck
// longest gets swarmed first.
export function StuckQueue({ tickets, now }: { tickets: Ticket[]; now: number }) {
  const stuck = tickets
    .filter((t): t is Ticket & { stuckAt: number } => t.stuckAt !== null)
    .sort((a, b) => a.stuckAt - b.stuckAt);

  if (stuck.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber/30 bg-white/5 p-4 text-white">
      <h2 className="font-mono text-xs uppercase tracking-widest text-amber">Stuck queue</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm">
        {stuck.map((ticket) => {
          const minutesAgo = Math.max(0, Math.floor((now - ticket.stuckAt) / 60_000));
          return (
            <li key={ticket.id}>
              <span className="inline-flex w-full items-center justify-between gap-2">
                <span className="truncate">{ticket.username}</span>
                <span className="shrink-0 text-xs opacity-60">
                  {minutesAgo === 0 ? "just now" : `stuck ${minutesAgo}m ago`}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
