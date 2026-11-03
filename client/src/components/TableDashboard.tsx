import { motion } from "framer-motion";
import { Avatar } from "./Avatar";
import { PerimeterRing } from "./PerimeterRing";
import { KudosButton } from "./KudosButton";
import { KUDOS_EMOJI, type ActivityMode, type RosterEntry, type TicketWithKudos, type TimerPayload } from "../types";

function ringColor(timer: TimerPayload): string {
  if (timer.status === "break") return "#e07a5f";
  if (timer.subphase === "collab") return "#10b981";
  if (timer.status === "focus") return "#d97706";
  return "#8a8a8e";
}

export function TableDashboard({
  tickets,
  roster,
  timer,
  mode,
  myUserId,
  leaderUserId,
  now,
  onToggleStuck,
  onSendKudos,
}: {
  tickets: TicketWithKudos[];
  roster: RosterEntry[];
  timer: TimerPayload;
  mode: ActivityMode;
  myUserId: number | undefined;
  leaderUserId: number | null;
  now: number;
  onToggleStuck: () => void;
  onSendKudos: (toUserId: number, emoji: string) => void;
}) {
  const elapsed =
    timer.status === "focus" && timer.phaseEndAt && timer.durationMs
      ? 1 - Math.max(0, timer.phaseEndAt - now) / timer.durationMs
      : timer.status === "break" && timer.phaseEndAt && timer.durationMs
        ? 1 - Math.max(0, timer.phaseEndAt - now) / timer.durationMs
        : 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tickets.map((ticket) => {
        const rosterEntry = roster.find((r) => r.userId === ticket.userId);
        const isMe = ticket.userId === myUserId;
        const tabHidden = rosterEntry?.tabHidden ?? false;
        return (
          <motion.div
            layout
            key={ticket.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`rounded-lg border p-4 ${
              timer.status === "idle" ? "border-black/10 bg-white" : "border-white/10 bg-white/5 text-white"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <PerimeterRing filled={elapsed} color={tabHidden ? "#d97706" : ringColor(timer)} size={44} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Avatar name={ticket.username} size={28} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {ticket.username}
                  {isMe && <span className="ml-1 opacity-60">(you)</span>}
                  {ticket.userId === leaderUserId && (
                    <span className="ml-1.5 text-xs font-normal uppercase tracking-wide opacity-60">Leader</span>
                  )}
                </p>
                {tabHidden && <p className="text-xs text-amber-500">away from tab</p>}
              </div>
              {ticket.stuck && mode === "problem" && (
                <span title="stuck — needs help" className="shrink-0 text-lg">
                  🆘
                </span>
              )}
            </div>
            <p className="mt-3 break-words font-mono text-sm opacity-90">{ticket.body}</p>

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
              <p className="mt-2 text-xs opacity-70">
                {ticket.kudos.map((k) => k.emoji).join(" ")} from the table
              </p>
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
