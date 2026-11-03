import { Avatar } from "./Avatar";
import type { RosterEntry } from "../types";

export function PresentRoster({
  entries,
  myUserId,
  shadowCount,
}: {
  entries: RosterEntry[];
  myUserId: number | undefined;
  shadowCount: number;
}) {
  if (entries.length === 0 && shadowCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-black/5 bg-white/40 px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-slate">In the room</span>
      {entries.map((r) => (
        <div key={r.userId} className="flex items-center gap-1.5">
          <Avatar name={r.username} size={20} />
          <span className={r.userId === myUserId ? "text-sm font-medium text-charcoal" : "text-sm text-slate"}>
            {r.username}
          </span>
          {r.tabHidden && <span className="h-1.5 w-1.5 rounded-full bg-amber-dim" />}
        </div>
      ))}
      {shadowCount > 0 && <span className="text-xs text-slate">+{shadowCount} watching</span>}
    </div>
  );
}
