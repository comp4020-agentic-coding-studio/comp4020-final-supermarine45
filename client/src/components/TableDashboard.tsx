import { useEffect, useRef, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Avatar } from "./Avatar";
import { PerimeterRing } from "./PerimeterRing";
import { KudosButton } from "./KudosButton";
import { KUDOS_ICON } from "./kudosIcons";
import { ticketBodyError } from "../validation";
import { KUDOS_EMOJI, type ActivityMode, type RosterEntry, type TicketWithKudos, type TimerPayload } from "../types";

// How long the old (struck-through) body stays visible next to the new one
// before the flash clears — just long enough to read, well short of anything
// that could read as a persistent "diff view" (Calm Technology).
const PIVOT_FLASH_MS = 1600;
// A single low-opacity pulse, not a looping animation — CLAUDE.md's Calm
// Technology mandate rules out anything resembling "animated avatars".
const RIPPLE_MS = 800;

export function ringColor(timer: TimerPayload): string {
  if (timer.status === "break") return "#e07a5f";
  if (timer.subphase === "collab") return "#10b981";
  if (timer.status === "focus") return "#d97706";
  return "#8a8a8e";
}

// Tracks each ticket's previous body by id so a Pivot (body change mid-cycle,
// same ticket id) can briefly show the old goal struck through next to the
// new one before settling — the "Live Replicated Effect" from the Pivot Goal
// feature. A brand-new ticket id (reboard) never triggers this.
function usePivotFlashes(tickets: TicketWithKudos[]): Map<number, string> {
  const prevBodies = useRef<Map<number, string>>(new Map());
  const [flashes, setFlashes] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const prev = prevBodies.current;
    const next = new Map<number, string>();
    let changed = false;
    for (const ticket of tickets) {
      const prevBody = prev.get(ticket.id);
      if (prevBody !== undefined && prevBody !== ticket.body) {
        next.set(ticket.id, prevBody);
        changed = true;
      }
      prev.set(ticket.id, ticket.body);
    }
    if (changed) {
      setFlashes(next);
      const timer = setTimeout(() => setFlashes(new Map()), PIVOT_FLASH_MS);
      return () => clearTimeout(timer);
    }
  }, [tickets]);

  return flashes;
}

export function TableDashboard({
  tickets,
  roster,
  timer,
  mode,
  myUserId,
  now,
  onToggleStuck,
  onSendKudos,
  onPivotTicket,
}: {
  tickets: TicketWithKudos[];
  roster: RosterEntry[];
  timer: TimerPayload;
  mode: ActivityMode;
  myUserId: number | undefined;
  now: number;
  onToggleStuck: () => void;
  onSendKudos: (toUserId: number, emoji: string) => void;
  onPivotTicket: (body: string) => void;
}) {
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [pivotInput, setPivotInput] = useState("");
  const [pivotError, setPivotError] = useState<string | null>(null);
  const pivotFlashes = usePivotFlashes(tickets);

  const elapsed =
    timer.status === "focus" && timer.phaseEndAt && timer.durationMs
      ? 1 - Math.max(0, timer.phaseEndAt - now) / timer.durationMs
      : timer.status === "break" && timer.phaseEndAt && timer.durationMs
        ? 1 - Math.max(0, timer.phaseEndAt - now) / timer.durationMs
        : 0;

  function startPivot(ticket: TicketWithKudos): void {
    setEditingTicketId(ticket.id);
    setPivotInput(ticket.body);
    setPivotError(null);
  }

  function submitPivot(e: React.FormEvent): void {
    e.preventDefault();
    const err = ticketBodyError(pivotInput);
    if (err) {
      setPivotError(err);
      return;
    }
    onPivotTicket(pivotInput.trim());
    setEditingTicketId(null);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tickets.map((ticket) => {
        const rosterEntry = roster.find((r) => r.userId === ticket.userId);
        const isMe = ticket.userId === myUserId;
        const checkinPending = rosterEntry?.checkinPending ?? false;
        const canPivot = isMe && timer.status === "focus";
        const isEditing = editingTicketId === ticket.id;
        const flashBody = pivotFlashes.get(ticket.id);
        // Personal block overlay: own card only, computed independently of
        // the shared `elapsed` above (which stays driven by the table-wide
        // timer.phaseEndAt/durationMs for every ring, including this one) —
        // this never touches the shared table clock, just reads back the
        // shorter duration this user picked for themselves at board time.
        const personalTotalMin = isMe && ticket.personalDurationMs != null ? Math.round(ticket.personalDurationMs / 60_000) : null;
        const personalElapsedMin =
          personalTotalMin !== null
            ? Math.min(personalTotalMin, Math.max(0, Math.floor((now - ticket.cycleStartAt) / 60_000)))
            : null;
        const personalDone = personalTotalMin !== null && personalElapsedMin !== null && personalElapsedMin >= personalTotalMin;
        return (
          <motion.div
            layout
            key={ticket.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`relative overflow-hidden rounded-xl border p-4 ${
              // The idle card is a literal white "paper" surface regardless
              // of the site's light/dark chrome theme (same convention as
              // TicketForm's input box) — so its text needs an explicit
              // dark color too, rather than inheriting text-ink, which goes
              // light in dark chrome mode and disappears against this card.
              timer.status === "idle" ? "border-black/10 bg-white text-charcoal" : "border-white/10 bg-white/5 text-white"
            }`}
            onDoubleClick={() => canPivot && !isEditing && startPivot(ticket)}
          >
            <AnimatePresence>
              {flashBody !== undefined && (
                <motion.div
                  key={`ripple-${flashBody}`}
                  initial={{ opacity: 0.15, scale: 0.3 }}
                  animate={{ opacity: 0, scale: 2.2 }}
                  transition={{ duration: RIPPLE_MS / 1000, ease: "easeOut" }}
                  className="pointer-events-none absolute inset-0 rounded-full bg-violet-400"
                  style={{ transformOrigin: "center" }}
                />
              )}
            </AnimatePresence>
            <div className="flex items-center gap-3">
              <div className="relative">
                <PerimeterRing filled={elapsed} color={checkinPending ? "#d97706" : ringColor(timer)} size={44} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Avatar name={ticket.username} size={28} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {ticket.username}
                  {isMe && <span className="ml-1 opacity-60">(you)</span>}
                </p>
                {checkinPending && <p className="text-xs text-amber-500">check-in pending</p>}
                {personalTotalMin !== null && (
                  <p className={`text-xs ${personalDone ? "text-amber-500" : "opacity-60"}`}>
                    personal block: {personalElapsedMin}/{personalTotalMin}m{personalDone ? " — time's up" : ""}
                  </p>
                )}
              </div>
              {ticket.stuck && mode === "problem" && (
                <span title="stuck — needs help" className="shrink-0 text-amber-600">
                  <LifeBuoy size={18} strokeWidth={1.5} />
                </span>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={submitPivot} className="mt-3 space-y-1">
                <input
                  autoFocus
                  value={pivotInput}
                  maxLength={60}
                  onChange={(e) => {
                    setPivotInput(e.target.value);
                    setPivotError(null);
                  }}
                  className="w-full rounded border border-current bg-transparent px-2 py-1 font-mono text-sm outline-none"
                />
                {pivotError && <p className="text-xs text-amber">{pivotError}</p>}
                <div className="flex gap-2">
                  <button type="submit" className="rounded-md bg-violet-500 px-3 py-1 text-xs font-medium text-white">
                    Pivot
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTicketId(null)}
                    className="rounded-md border border-current px-3 py-1 text-xs opacity-70 hover:opacity-100"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                {flashBody !== undefined && (
                  <p className="mt-3 break-words font-mono text-sm opacity-50 line-through">{flashBody}</p>
                )}
                <motion.p
                  key={ticket.body}
                  initial={flashBody !== undefined ? { opacity: 0 } : false}
                  animate={{ opacity: 0.9 }}
                  transition={{ duration: 0.4 }}
                  className={`break-words font-mono text-sm ${flashBody !== undefined ? "mt-1" : "mt-3"}`}
                >
                  {ticket.body}
                </motion.p>
                {canPivot && !flashBody && (
                  <p className="mt-1 text-[11px] opacity-40">Double-click to pivot your goal</p>
                )}
              </>
            )}

            {mode === "problem" && isMe && timer.status === "focus" && timer.subphase === "solo" && (
              <button
                type="button"
                onClick={onToggleStuck}
                className={`mt-3 rounded-md px-3 py-1 text-xs font-medium transition ${
                  ticket.stuck ? "bg-amber-600 text-white" : "border border-current opacity-70 hover:opacity-100"
                }`}
              >
                {ticket.stuck ? "Unflag stuck" : "I'm stuck — swarm me"}
              </button>
            )}

            {timer.status === "break" && (
              <div className="mt-3 flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    ticket.stamp === "completed"
                      ? "bg-sage/20 text-sage"
                      : ticket.stamp === "partial"
                        ? "bg-amber/20 text-amber"
                        : ticket.stamp === "pivoted"
                          ? "bg-violet-400/20 text-violet-300"
                          : "opacity-50"
                  }`}
                >
                  {ticket.stamp ?? "not checked out"}
                </span>
                {!isMe && myUserId !== undefined && (
                  <div className="flex gap-1">
                    {KUDOS_EMOJI.map((emoji) => (
                      <KudosButton
                        key={emoji}
                        emoji={emoji}
                        given={ticket.kudos.some((k) => k.fromUserId === myUserId && k.emoji === emoji)}
                        disabled={false}
                        onSend={() => onSendKudos(ticket.userId, emoji)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            {ticket.kudos.length > 0 && (
              <div className="mt-2 flex items-center gap-1 text-xs opacity-70">
                <div className="flex items-center gap-0.5">
                  {ticket.kudos.map((k, i) => {
                    const Icon = KUDOS_ICON[k.emoji as keyof typeof KUDOS_ICON];
                    return Icon ? <Icon key={i} size={12} strokeWidth={1.5} /> : <span key={i}>{k.emoji}</span>;
                  })}
                </div>
                from the table
              </div>
            )}
          </motion.div>
        );
      })}
      {tickets.length === 0 && (
        <p className="col-span-full py-8 text-center text-sm text-slate">
          No one's boarded this table yet. Submit a ticket to claim the next cycle.
        </p>
      )}
    </div>
  );
}
