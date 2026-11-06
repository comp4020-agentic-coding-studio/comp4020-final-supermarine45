import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KUDOS_EMOJI, type ActivityMode, type Ticket, type TicketWithKudos } from "../types";
import { KudosButton } from "./KudosButton";
import { TicketForm } from "./TicketForm";
import { Callout } from "./Callout";

// Self-Regulated Learning reflection prompts — static client-only copy, no
// server round-trip (plan §2: "90s mode-specific SSRL reflection prompt").
const SSRL_PROMPT: Record<ActivityMode, string> = {
  silent: "What did you actually get through? Would the next 50 minutes be better spent the same way, or differently?",
  writing: "Did the feedback swap change anything about your draft? What will you revise first?",
  pitch: "Did explaining it out loud expose a gap in your own understanding? What's still fuzzy?",
  problem: "If you got stuck, did the swarm actually unblock you? What's the very next step?",
};

type Card = "stamp" | "reflect" | "kudos";

export function BreakModal({
  mode,
  myTicket,
  tickets,
  myUserId,
  onStamp,
  onSendKudos,
  onReboard,
  onLeave,
  reboardedBody,
}: {
  mode: ActivityMode;
  myTicket: Ticket | null;
  tickets: TicketWithKudos[];
  myUserId: number | undefined;
  onStamp: (stamp: "completed" | "partial" | "pivoted") => void;
  onSendKudos: (toUserId: number, emoji: string) => void;
  onReboard: (body: string, personalDurationMinutes?: number) => void;
  onLeave: () => void;
  // The server can't address the *next* cycle until the table actually goes
  // idle (see TablePage), so a reboard made here is queued, not submitted
  // yet — this renders that queued state instead of the form once set.
  reboardedBody: string | null;
}) {
  const [card, setCard] = useState<Card>("stamp");
  const [reflectSecondsLeft, setReflectSecondsLeft] = useState(90);

  useEffect(() => {
    if (card !== "reflect") return;
    setReflectSecondsLeft(90);
    const interval = setInterval(() => {
      setReflectSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [card]);

  const others = tickets.filter((t) => t.userId !== myUserId);

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
        <div className="mb-4 flex justify-center gap-1.5">
          {(["stamp", "reflect", "kudos"] as Card[]).map((c) => (
            <span key={c} className={`h-1.5 w-8 rounded-full ${card === c ? "bg-terracotta" : "bg-white/15"}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {card === "stamp" && (
            <motion.div
              key="stamp"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="font-mono text-lg">Check off your ticket</h2>
              <p className="mt-1 text-sm text-cream/70">"{myTicket?.body ?? "—"}"</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onStamp("completed");
                    setCard("reflect");
                  }}
                  className="flex-1 rounded-md bg-sage px-4 py-2 text-sm font-medium text-espresso"
                >
                  Completed it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onStamp("partial");
                    setCard("reflect");
                  }}
                  className="flex-1 rounded-md border border-white/20 px-4 py-2 text-sm font-medium"
                >
                  Partial progress
                </button>
              </div>
              {myTicket?.pivotedAt != null && (
                <button
                  type="button"
                  onClick={() => {
                    onStamp("pivoted");
                    setCard("reflect");
                  }}
                  className="mt-2 w-full rounded-md border border-violet-400/40 bg-violet-400/10 px-4 py-2 text-sm font-medium text-violet-300"
                >
                  Pivoted &mdash; finished the new goal
                </button>
              )}
            </motion.div>
          )}

          {card === "reflect" && (
            <motion.div
              key="reflect"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="font-mono text-lg">A moment to reflect</h2>
              <div className="mt-3">
                <Callout tone="yellow" dark>
                  <p className="text-xs uppercase tracking-wide opacity-70">The room asks&hellip;</p>
                  <p className="mt-1 text-sm">{SSRL_PROMPT[mode]}</p>
                </Callout>
              </div>
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-terracotta transition-[width] duration-1000 ease-linear"
                  style={{ width: `${(reflectSecondsLeft / 90) * 100}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => setCard("kudos")}
                className="mt-4 w-full rounded-md border border-white/20 px-4 py-2 text-sm font-medium"
              >
                Continue{reflectSecondsLeft > 0 ? ` (${reflectSecondsLeft}s)` : ""}
              </button>
            </motion.div>
          )}

          {card === "kudos" && (
            <motion.div
              key="kudos"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="font-mono text-lg">Give kudos</h2>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {others.length === 0 && <p className="text-sm text-cream/50">No one else boarded this cycle.</p>}
                {others.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{t.username}</span>
                    <div className="flex gap-1">
                      {KUDOS_EMOJI.map((emoji) => (
                        <KudosButton
                          key={emoji}
                          emoji={emoji}
                          given={t.kudos.some((k) => k.fromUserId === myUserId && k.emoji === emoji)}
                          disabled={false}
                          onSend={() => onSendKudos(t.userId, emoji)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="mb-2 text-sm font-medium">Re-board for the next cycle?</p>
                {reboardedBody !== null ? (
                  <p className="rounded-md border border-sage/30 bg-sage/10 px-3 py-2 text-sm text-sage">
                    Queued: &ldquo;{reboardedBody}&rdquo; &mdash; will board as soon as the next cycle starts.
                  </p>
                ) : (
                  <TicketForm initialValue="" onSubmit={onReboard} disabled={false} dark />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={onLeave}
          className="mt-5 w-full text-center text-xs text-cream/50 underline underline-offset-2 hover:text-cream/80"
        >
          Leave the room
        </button>
      </motion.div>
    </motion.div>
  );
}
