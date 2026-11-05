import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../context/useAuth";
import { useTableSocket } from "../hooks/useTableSocket";
import { cancelSchedule, planSession } from "../api";
import { PhaseBanner } from "../components/PhaseBanner";
import { TicketForm } from "../components/TicketForm";
import { TableDashboard } from "../components/TableDashboard";
import { PresentRoster } from "../components/PresentRoster";
import { BreakModal } from "../components/BreakModal";
import { StuckQueue } from "../components/StuckQueue";
import { Whiteboard } from "../components/Whiteboard";
import { ClockIcon } from "../components/icons";
import { ticketBodyError } from "../validation";
import type { ActivityMode, RoomStatus } from "../types";

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const ERROR_COPY: Record<string, string> = {
  not_found: "That location or mode doesn't exist.",
  table_full: "This table is full for the next cycle (max 6). Try another mode, or wait for a seat to free up.",
  unauthorized: "You need a name to do that — join in below.",
  wrong_mode: "The stuck flag only applies in Problem-Solving mode.",
  not_breaking: "You can only check off your ticket during the break.",
};

export function TablePage() {
  const { slug, mode: modeParam } = useParams<{ slug: string; mode: string }>();
  const mode = modeParam as ActivityMode | undefined;
  const { me } = useAuth();
  const now = useNow();
  const {
    joined,
    room,
    error,
    isShadow,
    cursors,
    submitTicket,
    toggleStuck,
    stampTicket,
    sendKudos,
    setPseudonym,
    castVote,
    launchWhiteboard,
    initiateVote,
    whiteboardPaste,
    whiteboardHighlight,
    whiteboardCursor,
    reconnect,
  } = useTableSocket(slug, mode);

  const [pseudonymInput, setPseudonymInput] = useState("");
  const [queuedReboard, setQueuedReboard] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [autoJoin, setAutoJoin] = useState(false);
  const [autoJoinBody, setAutoJoinBody] = useState("");
  const [autoJoinError, setAutoJoinError] = useState<string | null>(null);

  const prevStatusRef = useRef<RoomStatus | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur = room?.timer.status;
    if (prev === "break" && cur === "idle") {
      if (queuedReboard !== null) {
        submitTicket(queuedReboard);
        setQueuedReboard(null);
      } else if (autoJoin && autoJoinBody.trim()) {
        submitTicket(autoJoinBody);
      }
    }
    prevStatusRef.current = cur;
  }, [room?.timer.status, queuedReboard, autoJoin, autoJoinBody, submitTicket]);

  if (!slug || !mode) return null;

  const myUserId = me?.id;
  const myTicket = room?.tickets.find((t) => t.userId === myUserId) ?? joined?.myTicket ?? null;
  const unboardedRoster = (room?.roster ?? []).filter((r) => !(room?.tickets ?? []).some((t) => t.userId === r.userId));
  const canPlan = !!me && !me.isGuest;
  // Solo Gate and Open Collab both read as OLED Black per the design system
  // (CLAUDE.md §4) — only the accent color (amber vs sage) differs between
  // them, and that distinction already lives in PhaseBanner/TableDashboard.
  // Break has its own espresso+blur overlay (BreakModal) regardless of what's
  // behind it, so only "focus" needs the page-level background to go dark.
  const isDark = room?.timer.status === "focus";

  async function handlePlanSession(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setScheduleError(null);
    if (!scheduleAt) return;
    const startsAt = new Date(scheduleAt).getTime();
    const result = await planSession(slug!, startsAt);
    if ("error" in result) setScheduleError(result.error);
    else setScheduleAt("");
  }

  function handleEnableAutoJoin(e: React.FormEvent): void {
    e.preventDefault();
    const body = autoJoinBody.trim() || myTicket?.body || "";
    const err = ticketBodyError(body);
    if (err) {
      setAutoJoinError(err);
      return;
    }
    setAutoJoinBody(body);
    setAutoJoinError(null);
    setAutoJoin(true);
    if (room?.timer.status === "idle") submitTicket(body);
  }

  function handleStopAutoJoin(): void {
    setAutoJoin(false);
    setAutoJoinError(null);
  }

  const mine = (room?.upcoming ?? []).filter((s) => me && s.username === me.username);
  const others = (room?.upcoming ?? []).filter((s) => !me || s.username !== me.username);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to={`/room/${slug}`} className="text-sm text-ink-muted underline">
        &larr; {joined?.location.name ?? slug}
      </Link>
      <h1 className="mt-2 font-mono text-2xl font-semibold text-ink">{joined?.modeInfo.label ?? mode}</h1>
      {joined && <p className="mt-1 text-sm text-ink-muted">{joined.modeInfo.description}</p>}

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{ERROR_COPY[error.error] ?? error.error}</span>
          <button type="button" onClick={reconnect} className="shrink-0 underline">
            retry
          </button>
        </div>
      )}

      {!joined && !error && <p className="mt-6 text-sm text-ink-muted">Connecting&hellip;</p>}

      {joined && (
        <div
          className={`mt-6 space-y-6 rounded-xl transition-colors duration-700 ${isDark ? "bg-oled p-6" : ""}`}
        >
          <PhaseBanner timer={room?.timer ?? { status: "idle", phaseEndAt: null, durationMs: null, subphase: null }} now={now} />

          {isShadow ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (pseudonymInput.trim()) setPseudonym(pseudonymInput.trim());
              }}
              className="flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-3"
            >
              <span className="text-sm text-ink-muted">Watching only &mdash; pick a name to join in:</span>
              <input
                value={pseudonymInput}
                maxLength={24}
                onChange={(e) => setPseudonymInput(e.target.value)}
                placeholder="e.g. Quiet Otter"
                className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-ink outline-none focus:border-ink"
              />
              <button type="submit" className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-canvas">
                Join in
              </button>
            </form>
          ) : (
            room &&
            room.timer.status !== "break" && (
              <TicketForm
                key={room.cycleStartAt}
                initialValue={myTicket?.body ?? ""}
                onSubmit={submitTicket}
                disabled={false}
                dark={isDark}
              />
            )
          )}

          {!isShadow && (
            <div className={`rounded-lg border p-4 ${isDark ? "border-white/10 bg-white/5 text-white" : "border-black/10 bg-white"}`}>
              {autoJoin ? (
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-sm ${isDark ? "text-sage" : "text-sage-dim"}`}>
                    Auto-join on &mdash; &ldquo;{autoJoinBody}&rdquo; will board every cycle until you stop it.
                  </p>
                  <button
                    type="button"
                    onClick={handleStopAutoJoin}
                    className="shrink-0 rounded-md border border-current px-3 py-1 text-xs font-medium opacity-80 hover:opacity-100"
                  >
                    Stop
                  </button>
                </div>
              ) : (
                <form onSubmit={handleEnableAutoJoin} className="space-y-2">
                  <p className="text-sm font-medium">Auto-join the next session</p>
                  <p className={`text-xs ${isDark ? "text-white/60" : "text-slate"}`}>
                    Automatically board this table every cycle with the same ticket, until you stop it.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={autoJoinBody}
                      maxLength={60}
                      onChange={(e) => {
                        setAutoJoinBody(e.target.value);
                        setAutoJoinError(null);
                      }}
                      placeholder={myTicket?.body || "What will you work on each cycle?"}
                      className={`min-w-0 flex-1 rounded border px-2 py-1 font-mono text-sm outline-none ${
                        isDark ? "border-white/20 bg-transparent text-white placeholder:text-white/40" : "border-black/15 focus:border-charcoal"
                      }`}
                    />
                    <button type="submit" className="shrink-0 rounded-md bg-charcoal px-3 py-1.5 text-sm font-medium text-paper">
                      Start auto-join
                    </button>
                  </div>
                  {autoJoinError && <p className="text-xs text-amber-dim">{autoJoinError}</p>}
                </form>
              )}
            </div>
          )}

          <PresentRoster entries={unboardedRoster} myUserId={myUserId} shadowCount={room?.shadowCount ?? 0} />

          <TableDashboard
            tickets={room?.tickets ?? []}
            roster={room?.roster ?? []}
            timer={room?.timer ?? { status: "idle", phaseEndAt: null, durationMs: null, subphase: null }}
            mode={mode}
            myUserId={myUserId}
            leaderUserId={room?.leaderUserId ?? null}
            now={now}
            onToggleStuck={toggleStuck}
            onSendKudos={sendKudos}
          />

          {room && mode === "problem" && room.timer.status === "focus" && (
            <StuckQueue tickets={room.tickets} now={now} />
          )}

          {room && mode === "problem" && room.timer.status === "focus" && room.timer.subphase === "collab" && (
            <Whiteboard
              isLeader={myUserId !== undefined && myUserId === room.leaderUserId}
              myUserId={myUserId}
              roster={room.roster}
              whiteboardOpenedAt={room.whiteboardOpenedAt}
              whiteboardText={room.whiteboardText}
              whiteboardHighlights={room.whiteboardHighlights}
              cursors={cursors}
              now={now}
              onLaunch={launchWhiteboard}
              onPaste={whiteboardPaste}
              onHighlight={whiteboardHighlight}
              onCursor={whiteboardCursor}
            />
          )}

          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-medium text-ink">
              <ClockIcon className="text-ink-muted" />
              Plan ahead
            </h2>
            <p className="mt-1 text-xs text-ink-muted">Book a future hourly cycle at this hub so others know you're coming.</p>
            <div className="mt-3 space-y-1">
              {mine.length === 0 && others.length === 0 && (
                <p className="text-sm text-ink-muted">Nobody's planned a session here yet.</p>
              )}
              {mine.length > 0 && (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Yours</p>
                  {mine.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm text-ink">
                      <span>{new Date(s.startsAt).toLocaleString()}</span>
                      <button type="button" onClick={() => cancelSchedule(s.id)} className="text-ink-muted underline">
                        cancel
                      </button>
                    </div>
                  ))}
                </>
              )}
              {others.length > 0 && (
                <>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Others</p>
                  {others.map((s) => (
                    <div key={s.id} className="text-sm text-ink-muted">
                      {new Date(s.startsAt).toLocaleString()} &mdash; {s.username}
                    </div>
                  ))}
                </>
              )}
            </div>
            {canPlan ? (
              <form onSubmit={handlePlanSession} className="mt-3 flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink"
                />
                <button type="submit" className="rounded-md border border-ink px-3 py-1.5 text-sm font-medium text-ink">
                  Plan session
                </button>
              </form>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">Registered accounts only &mdash; log in to plan ahead.</p>
            )}
            {scheduleError && <p className="mt-1 text-xs text-amber-700">{scheduleError}</p>}
          </section>
        </div>
      )}

      <AnimatePresence>
        {room?.timer.status === "break" && !isShadow && (
          <motion.div key="break-modal">
            <BreakModal
              mode={mode}
              myTicket={myTicket}
              tickets={room.tickets}
              myUserId={myUserId}
              leaderUserId={room.leaderUserId}
              voteOpenedAt={room.voteOpenedAt}
              onStamp={stampTicket}
              onSendKudos={sendKudos}
              onReboard={setQueuedReboard}
              onCastVote={castVote}
              onInitiateVote={initiateVote}
              reboardedBody={queuedReboard}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
