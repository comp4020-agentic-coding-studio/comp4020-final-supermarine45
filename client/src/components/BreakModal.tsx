import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KUDOS_EMOJI, type ActivityMode, type Ticket, type TicketWithKudos } from "../types";
import { KudosButton } from "./KudosButton";
import { TicketForm } from "./TicketForm";

// Self-Regulated Learning reflection prompts — static client-only copy, no
// server round-trip (plan §2: "90s mode-specific SSRL reflection prompt").
const SSRL_PROMPT: Record<ActivityMode, string> = {
  silent: "What did you actually get through? Would the next 50 minutes be better spent the same way, or differently?",
  writing: "Did the feedback swap change anything about your draft? What will you revise first?",
  pitch: "Did explaining it out loud expose a gap in your own understanding? What's still fuzzy?",
  problem: "If you got stuck, did the swarm actually unblock you? What's the very next step?",
};

type Card = "stamp" | "reflect" | "kudos" | "vote";

export function BreakModal({
  mode,
  myTicket,
  tickets,
  myUserId,
  leaderUserId,
  voteOpenedAt,
  onStamp,
  onSendKudos,
  onReboard,
  onCastVote,
  onInitiateVote,
  reboardedBody,
}: {
  mode: ActivityMode;
  myTicket: Ticket | null;
  tickets: TicketWithKudos[];
  myUserId: number | undefined;
  leaderUserId: number | null;
  voteOpenedAt: number | null;
  onStamp: (stamp: "completed" | "partial") => void;
  onSendKudos: (toUserId: number, emoji: string) => void;
  onReboard: (body: string) => void;
  onCastVote: (vote: "yes" | "no") => void;
  onInitiateVote: () => void;
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
  const isLeader = myUserId !== undefined && myUserId === leaderUserId;
  const yesCount = tickets.filter((t) => t.vote === "yes").length;
  const noCount = tickets.filter((t) => t.vote === "no").length;
  const leaderVote = tickets.find((t) => t.userId === leaderUserId)?.vote ?? null;

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
        className="w-full max-w-md rounded-xl bg-espresso p-6 text-cream shadow-2xl"
      >
        <div className="mb-4 flex justify-center gap-1.5">
          {(["stamp", "reflect", "kudos", "vote"] as Card[]).map((c) => (
            <span key={c} className={`h-1.5 w-8 rounded-full ${card === c ? "bg-terracotta" : "bg-white/15"}`} />
          ))}
        </div>

        {isLeader && !voteOpenedAt && (
          <button
            type="button"
            onClick={onInitiateVote}
            className="mb-4 w-full rounded-md border border-terracotta/40 px-3 py-1.5 text-xs font-medium text-terracotta"
          >
            Open the vote for everyone
          </button>
        )}

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
              <p className="mt-2 text-xs uppercase tracking-wide text-cream/50">Your pod leader asks&hellip;</p>
              <p className="mt-1 text-sm text-cream/80">{SSRL_PROMPT[mode]}</p>
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
              <button
                type="button"
                onClick={() => setCard("vote")}
                className="mt-4 w-full rounded-md border border-white/20 px-4 py-2 text-sm font-medium"
              >
                Continue
              </button>
            </motion.div>
          )}

          {card === "vote" && (
            <motion.div
              key="vote"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="font-mono text-lg">Keep the streak going?</h2>
              {voteOpenedAt ? (
                <>
                  <p className="mt-1 text-sm text-cream/70">Vote to roll the whole table into the next cycle.</p>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onCastVote("yes")}
                      className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                        myTicket?.vote === "yes" ? "bg-sage text-espresso" : "border border-sage/40 text-sage"
                      }`}
                    >
                      Yes, continue
                    </button>
                    <button
                      type="button"
                      onClick={() => onCastVote("no")}
                      className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                        myTicket?.vote === "no" ? "bg-white/20 text-cream" : "border border-white/20 text-cream/80"
                      }`}
                    >
                      No, I'm done
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-cream/60">
                    <span>
                      {yesCount} yes &middot; {noCount} no &middot; {tickets.length - yesCount - noCount} undecided
                    </span>
                    {leaderVote && (
                      <span className="rounded bg-terracotta/20 px-2 py-0.5 font-medium text-terracotta">
                        Leader voted {leaderVote}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-cream/60">
                  Waiting for the pod leader to open the vote&hellip; it'll open automatically if they don't.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
