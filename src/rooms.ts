import type { DatabaseSync } from "node:sqlite";
import type { Server, Socket } from "socket.io";
import type { Identity, Location, RoomStatus } from "./db.js";
import {
  addRoomGoal,
  clearRoomGoals,
  countUpcomingSessions,
  deleteRoomGoal,
  deleteUserChatMessages,
  deleteUserRow,
  deleteUserScheduledSessions,
  deleteUserSessions,
  getLocationBySlug,
  getRoomState,
  isGuest,
  listLocations,
  listRoomGoals,
  listUpcomingSessions,
  locationsStartedBy,
  randomEncouragement,
  toggleRoomGoal,
} from "./db.js";

export const FOCUS_PRESETS_MIN = [15, 25, 45, 50] as const;
export const DEFAULT_FOCUS_MIN = 25;
export const BREAK_DURATION_MS = 5 * 60 * 1000;
// Fixed window to react to an unfinished shared goal list before the room
// moves on to break regardless — short on purpose, since it's a decision
// point ("extend or let it lapse"), not a second focus block.
export const REVIEW_WINDOW_MS = 3 * 60 * 1000;

// Schelling points: a lobby's resolved focus block always lands on a
// wall-clock :00/:30 mark, so a group coordinating a start time converges on
// the same mark without having to negotiate it directly.
export const GRID_INTERVAL_MS = 30 * 60 * 1000;
// If the next mark is only moments away, push to the one after — a lobby
// that resolves before anyone could plausibly vote isn't a vote.
const MIN_LOBBY_MS = 90 * 1000;

export function nextGridMark(now: number): number {
  let mark = Math.ceil(now / GRID_INTERVAL_MS) * GRID_INTERVAL_MS;
  if (mark - now < MIN_LOBBY_MS) mark += GRID_INTERVAL_MS;
  return mark;
}

// Highest vote count wins; a tie breaks toward the shorter preset (consistent
// with "removes choices" — when undecided, default to less commitment, not
// more). No votes at all falls back to the room's default preset.
export function resolveVotes(tally: Map<number, number>): number {
  if (tally.size === 0) return DEFAULT_FOCUS_MIN;
  let winner = DEFAULT_FOCUS_MIN;
  let bestCount = -1;
  for (const [minutes, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      bestCount = count;
      winner = minutes;
    }
  }
  return winner;
}

interface Presence {
  socketId: string;
  user: Identity;
  joinedAt: number;
}

interface TimerPayload {
  status: RoomStatus;
  phaseEndAt: number | null;
  durationMs: number | null;
  startedByUsername: string | null;
}

export interface VoteTally {
  minutes: number;
  count: number;
}

interface RosterEntry {
  username: string;
  focusMinutesTotal: number | null;
  active: boolean;
  isGuest: boolean;
}

// location_id -> socketId -> presence. In-memory: who's actually connected
// right now. room_state in the DB is the durable, authoritative timer state.
const presence = new Map<number, Map<string, Presence>>();
const scheduledTransitions = new Map<number, NodeJS.Timeout>();
// Room-wide encouragement beats, keyed the same way. Deliberately a separate
// map from scheduledTransitions: these are cosmetic and never re-armed after
// a restart, unlike the authoritative phase transition above.
const encouragementTimers = new Map<number, NodeJS.Timeout[]>();
// Lobby vote tallies: location_id -> user_id -> chosen minutes. In-memory
// only, same as presence — a lost vote on restart just means the lobby falls
// back to the default preset, no different in severity from a missed
// encouragement beat.
const lobbyVotes = new Map<number, Map<number, number>>();

function tallyCounts(locationId: number): Map<number, number> {
  const votes = lobbyVotes.get(locationId);
  const counts = new Map<number, number>();
  if (!votes) return counts;
  for (const minutes of votes.values()) counts.set(minutes, (counts.get(minutes) ?? 0) + 1);
  return counts;
}

function voteTally(locationId: number): VoteTally[] {
  return [...tallyCounts(locationId).entries()].map(([minutes, count]) => ({ minutes, count }));
}

function roomName(locationId: number): string {
  return `room:${locationId}`;
}

// A guest's username never lives in the DB, so a guest started_by can only
// be resolved from whoever's still actually present in the room — if they've
// since left, there's nothing left to recover it from, and that's fine: it's
// display-only.
function resolveStartedByUsername(db: DatabaseSync, locationId: number, startedBy: number): string | null {
  if (isGuest(startedBy)) {
    const room = presence.get(locationId);
    if (!room) return null;
    for (const p of room.values()) {
      if (p.user.id === startedBy) return p.user.username;
    }
    return null;
  }
  const row = db.prepare("SELECT username FROM users WHERE id = ?").get(startedBy) as unknown as
    | { username: string }
    | undefined;
  return row?.username ?? null;
}

function timerPayload(db: DatabaseSync, locationId: number): TimerPayload {
  const state = getRoomState(db, locationId);
  const durationMs = state.status === "idle" ? null : state.duration_ms;
  const startedByUsername =
    state.status !== "idle" && state.started_by !== null
      ? resolveStartedByUsername(db, locationId, state.started_by)
      : null;
  return { status: state.status, phaseEndAt: state.phase_end_at, durationMs, startedByUsername };
}

function roster(locationId: number): RosterEntry[] {
  const room = presence.get(locationId);
  if (!room) return [];
  return [...room.values()].map((p) => ({
    username: p.user.username,
    focusMinutesTotal: isGuest(p.user.id) ? null : p.user.focus_minutes_total,
    active: true,
    isGuest: isGuest(p.user.id),
  }));
}

function occupancy(locationId: number): number {
  return presence.get(locationId)?.size ?? 0;
}

function broadcastLobby(io: Server, db: DatabaseSync): void {
  const locations = listLocations(db);
  const summary = locations.map((location) => {
    const state = getRoomState(db, location.id);
    return {
      slug: location.slug,
      name: location.name,
      buildingSlug: location.buildingSlug,
      buildingName: location.buildingName,
      occupants: occupancy(location.id),
      active: state.status === "focus",
      upcomingCount: countUpcomingSessions(db, location.id),
    };
  });
  io.to("lobby").emit("lobby:update", summary);
}

// Exported so routes/schedule.ts can re-broadcast a room after planning or
// cancelling a session, reusing this channel instead of a new event type.
export function broadcastRoom(io: Server, db: DatabaseSync, locationId: number): void {
  io.to(roomName(locationId)).emit("room:update", {
    timer: timerPayload(db, locationId),
    roster: roster(locationId),
    upcoming: listUpcomingSessions(db, locationId),
    goals: listRoomGoals(db, locationId),
    votes: voteTally(locationId),
  });
}

// cutoff caps how far past phaseStartedAt a user's overlap can count — the
// full block length on a normal transition, or "now" when a reset ends a
// block early, so only actually-elapsed time is ever awarded. Guests are
// skipped entirely — no DB row to credit, and "no rank or statistics" is
// the whole point of an anonymous session.
function awardFocusMinutes(
  db: DatabaseSync,
  locationId: number,
  phaseStartedAt: number,
  elapsedCapMs: number,
): void {
  const room = presence.get(locationId);
  if (!room) return;
  const cutoff = phaseStartedAt + elapsedCapMs;
  const update = db.prepare(
    "UPDATE users SET focus_minutes_total = focus_minutes_total + ? WHERE id = ?",
  );
  for (const p of room.values()) {
    if (isGuest(p.user.id)) continue;
    const overlapMs = cutoff - Math.max(p.joinedAt, phaseStartedAt);
    if (overlapMs <= 0) continue;
    const minutes = overlapMs / 60_000;
    update.run(minutes, p.user.id);
    p.user.focus_minutes_total += minutes;
  }
}

function clearSchedule(locationId: number): void {
  const timeout = scheduledTransitions.get(locationId);
  if (timeout) {
    clearTimeout(timeout);
    scheduledTransitions.delete(locationId);
  }
}

function clearEncouragements(locationId: number): void {
  const timers = encouragementTimers.get(locationId);
  if (timers) {
    for (const timer of timers) clearTimeout(timer);
    encouragementTimers.delete(locationId);
  }
}

// Room-wide beats at 25/50/75% of a focus block's duration, so a 15-min and a
// 50-min block both get exactly 3, proportionally spaced. Deliberately NOT
// re-armed in rearmTimers like the authoritative phase timer is: a missed
// beat after a server restart is cosmetic, not a correctness problem.
function scheduleEncouragements(io: Server, db: DatabaseSync, locationId: number, durationMs: number): void {
  clearEncouragements(locationId);
  const timers = [0.25, 0.5, 0.75].map((fraction) => {
    const timer = setTimeout(() => {
      const body = randomEncouragement(db);
      if (body) io.to(roomName(locationId)).emit("room:encouragement", { body });
    }, Math.max(durationMs * fraction, 0));
    timer.unref();
    return timer;
  });
  encouragementTimers.set(locationId, timers);
}

function schedule(io: Server, db: DatabaseSync, locationId: number, delayMs: number): void {
  clearSchedule(locationId);
  const timeout = setTimeout(() => advancePhase(io, db, locationId), Math.max(delayMs, 0));
  timeout.unref();
  scheduledTransitions.set(locationId, timeout);
}

function advancePhase(io: Server, db: DatabaseSync, locationId: number): void {
  const state = getRoomState(db, locationId);
  const now = Date.now();
  if (state.status === "focus") {
    awardFocusMinutes(db, locationId, state.phase_started_at!, state.duration_ms!);
    clearEncouragements(locationId);
    const goals = listRoomGoals(db, locationId);
    const hasUnfinished = goals.some((g) => !g.done);
    if (hasUnfinished) {
      // Goals are kept, not cleared, going into review — the whole point is
      // to look at what's still unchecked.
      db.prepare(
        "UPDATE room_state SET status = 'review', phase_end_at = ?, phase_started_at = ?, " +
          "duration_ms = ? WHERE location_id = ?",
      ).run(now + REVIEW_WINDOW_MS, now, REVIEW_WINDOW_MS, locationId);
      schedule(io, db, locationId, REVIEW_WINDOW_MS);
    } else {
      db.prepare(
        "UPDATE room_state SET status = 'break', phase_end_at = ?, phase_started_at = ?, " +
          "duration_ms = ? WHERE location_id = ?",
      ).run(now + BREAK_DURATION_MS, now, BREAK_DURATION_MS, locationId);
      schedule(io, db, locationId, BREAK_DURATION_MS);
    }
  } else if (state.status === "review") {
    // Nobody extended in time — the list is cleared, same as if it had never
    // been unfinished, and the room moves on to break as normal.
    clearRoomGoals(db, locationId);
    db.prepare(
      "UPDATE room_state SET status = 'break', phase_end_at = ?, phase_started_at = ?, duration_ms = ? " +
        "WHERE location_id = ?",
    ).run(now + BREAK_DURATION_MS, now, BREAK_DURATION_MS, locationId);
    schedule(io, db, locationId, BREAK_DURATION_MS);
  } else if (state.status === "break") {
    db.prepare(
      "UPDATE room_state SET status = 'idle', phase_end_at = NULL, phase_started_at = NULL, " +
        "duration_ms = NULL, started_by = NULL WHERE location_id = ?",
    ).run(locationId);
  } else if (state.status === "lobby") {
    // The grid mark has arrived: resolve the vote and begin the block for
    // everyone at once. started_by is always set here — only startLobby
    // enters this status, and it always sets it to the proposer.
    const minutes = resolveVotes(tallyCounts(locationId));
    lobbyVotes.delete(locationId);
    beginFocus(io, db, locationId, state.started_by!, minutes);
    return;
  }
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

// On boot, any room still mid-focus/break/review (phase_end_at in the future
// — an already-expired one was already reconciled to idle in db.ts) lost its
// in-memory setTimeout to the restart and must have it re-armed, or it would
// stay wedged in that phase forever once the clock runs out. Encouragement
// beats are NOT re-armed here — see scheduleEncouragements' comment.
export function rearmTimers(io: Server, db: DatabaseSync): void {
  const now = Date.now();
  const rows = db
    .prepare("SELECT location_id AS locationId, phase_end_at AS phaseEndAt FROM room_state WHERE status != 'idle' AND phase_end_at IS NOT NULL")
    .all() as unknown as Array<{ locationId: number; phaseEndAt: number }>;
  for (const row of rows) {
    schedule(io, db, row.locationId, Math.max(row.phaseEndAt - now, 0));
  }
}

// Shared by startFocus, extendFocus, and lobby-vote resolution: writes the
// focus phase, arms the phase-end timer and encouragement beats, and
// broadcasts. Callers each keep their own distinct guard (idle-only,
// review-only, or internal-to-advancePhase) before calling this.
function beginFocus(io: Server, db: DatabaseSync, locationId: number, userId: number, minutes: number): void {
  const now = Date.now();
  const durationMs = minutes * 60_000;
  db.prepare(
    "UPDATE room_state SET status = 'focus', phase_end_at = ?, phase_started_at = ?, duration_ms = ?, " +
      "started_by = ? WHERE location_id = ?",
  ).run(now + durationMs, now, durationMs, userId, locationId);
  schedule(io, db, locationId, durationMs);
  scheduleEncouragements(io, db, locationId, durationMs);
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

export function startFocus(
  io: Server,
  db: DatabaseSync,
  locationId: number,
  userId: number,
  minutes: number,
): void {
  const state = getRoomState(db, locationId);
  if (state.status !== "idle") return;
  if (!(FOCUS_PRESETS_MIN as readonly number[]).includes(minutes)) return;
  beginFocus(io, db, locationId, userId, minutes);
}

// Proposes a Schelling-point lobby: the room waits until the next wall-clock
// :00/:30 mark, during which anyone present can vote on the block length.
// Additive to startFocus, not a replacement — a room can still start
// instantly via a preset, same as before.
export function startLobby(io: Server, db: DatabaseSync, locationId: number, userId: number): void {
  const state = getRoomState(db, locationId);
  if (state.status !== "idle") return;
  lobbyVotes.set(locationId, new Map());
  const now = Date.now();
  const phaseEndAt = nextGridMark(now);
  db.prepare(
    "UPDATE room_state SET status = 'lobby', phase_end_at = ?, phase_started_at = ?, duration_ms = ?, " +
      "started_by = ? WHERE location_id = ?",
  ).run(phaseEndAt, now, phaseEndAt - now, userId, locationId);
  schedule(io, db, locationId, phaseEndAt - now);
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

// Casts (or changes) this user's vote for the current lobby's block length.
// Rejected outright outside a lobby or for a non-preset length — identical
// posture to startFocus/extendFocus ignoring an out-of-bounds minutes value.
export function castVote(io: Server, db: DatabaseSync, locationId: number, userId: number, minutes: number): void {
  const state = getRoomState(db, locationId);
  if (state.status !== "lobby") return;
  if (!(FOCUS_PRESETS_MIN as readonly number[]).includes(minutes)) return;
  if (!lobbyVotes.has(locationId)) lobbyVotes.set(locationId, new Map());
  lobbyVotes.get(locationId)!.set(userId, minutes);
  broadcastRoom(io, db, locationId);
}

// Open to anyone currently in the room when the block is in review — not
// gated to the original starter the way resetRoom is, because adding time
// can never be used to grief the room the way cutting a block short can.
// Whoever extends becomes the new started_by, since starting authority
// already means "whoever is acting now", and that keeps Reset meaningful for
// the extended block too. Goals are kept, not cleared: extending is for
// finishing the same unfinished list.
export function extendFocus(
  io: Server,
  db: DatabaseSync,
  locationId: number,
  userId: number,
  minutes: number,
): void {
  const state = getRoomState(db, locationId);
  if (state.status !== "review") return;
  if (!(FOCUS_PRESETS_MIN as readonly number[]).includes(minutes)) return;
  clearSchedule(locationId);
  beginFocus(io, db, locationId, userId, minutes);
}

// Ends whatever cycle is running right now, regardless of status — awards
// partial focus minutes if the room was mid-focus, clears goals, clears any
// pending phase/encouragement timers, and returns the room to idle. Shared
// by resetRoom (ownership-gated, user-initiated) and account deletion
// (ungated, system-initiated), so "end a room's cycle early" has exactly one
// implementation.
function forceEndRoom(io: Server, db: DatabaseSync, locationId: number): void {
  const state = getRoomState(db, locationId);
  if (state.status === "idle") return;
  if (state.status === "focus") {
    awardFocusMinutes(db, locationId, state.phase_started_at!, Date.now() - state.phase_started_at!);
  }
  clearSchedule(locationId);
  clearEncouragements(locationId);
  clearRoomGoals(db, locationId);
  lobbyVotes.delete(locationId);
  db.prepare(
    "UPDATE room_state SET status = 'idle', phase_end_at = NULL, phase_started_at = NULL, " +
      "duration_ms = NULL, started_by = NULL WHERE location_id = ?",
  ).run(locationId);
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

// Only the person who started a cycle can end it early — restricted to avoid
// one user cutting off everyone else's focus block now that lengths vary.
// Also allowed during review and lobby (same started_by-only check), so
// whoever's "in charge" can bail out immediately instead of always waiting
// for the window to lapse. Leaving the room by navigating away remains
// possible at any time regardless, for anyone — that's what "always have the
// option to leave" actually requires, not a second in-room "quit" button.
export function resetRoom(io: Server, db: DatabaseSync, locationId: number, userId: number): void {
  const state = getRoomState(db, locationId);
  if (state.status === "idle") return;
  if (state.started_by !== userId) return;
  forceEndRoom(io, db, locationId);
}

// System-driven cascade for account deletion. Any room this user started
// that's still mid-cycle is force-ended first (via the same forceEndRoom
// resetRoom uses) so nobody else present loses credit and started_by never
// dangles once the users row disappears underneath it. Scheduled sessions,
// chat messages and every session row are deleted before the user row
// itself; any socket(s) currently connected as this user are disconnected so
// the client can redirect cleanly rather than sit on a dead identity.
export function deleteAccount(io: Server, db: DatabaseSync, userId: number): void {
  for (const locationId of locationsStartedBy(db, userId)) {
    forceEndRoom(io, db, locationId);
  }
  const scheduleLocations = deleteUserScheduledSessions(db, userId);
  deleteUserChatMessages(db, userId);
  deleteUserSessions(db, userId);
  deleteUserRow(db, userId);
  for (const locationId of scheduleLocations) broadcastRoom(io, db, locationId);

  for (const room of presence.values()) {
    for (const [socketId, p] of room) {
      if (p.user.id !== userId) continue;
      const socket = io.sockets.sockets.get(socketId);
      socket?.emit("account:deleted");
      socket?.disconnect(true);
    }
  }
}

export function registerSocketHandlers(io: Server, db: DatabaseSync): void {
  io.on("connection", (socket: Socket) => {
    socket.join("lobby");

    let joinedLocationId: number | null = null;

    // Shadow viewing: a socket with no user still joins the Socket.IO room
    // and gets the same room:update/chat:history everyone else gets — it's
    // just never added to presence, so it never appears in the roster or
    // occupant count. Every *mutating* handler below independently checks
    // `if (!user) return`, so this is the only gate that needed to move.
    socket.on("room:join", ({ slug }: { slug: string }) => {
      const user: Identity | undefined = socket.data.user;
      const location: Location | undefined = getLocationBySlug(db, slug);
      if (!location) {
        socket.emit("room:error", "unknown location");
        return;
      }
      if (joinedLocationId !== null) leaveRoom(io, db, socket, joinedLocationId);

      joinedLocationId = location.id;
      socket.join(roomName(location.id));
      if (user) {
        if (!presence.has(location.id)) presence.set(location.id, new Map());
        presence.get(location.id)!.set(socket.id, { socketId: socket.id, user, joinedAt: Date.now() });
      }

      const recentChat = db
        .prepare(
          "SELECT chat_messages.body, chat_messages.created_at AS createdAt, users.username " +
            "FROM chat_messages JOIN users ON users.id = chat_messages.user_id " +
            "WHERE location_id = ? ORDER BY chat_messages.id DESC LIMIT 20",
        )
        .all(location.id)
        .reverse();
      socket.emit("chat:history", recentChat);
      // The latecomer sync: broadcastRoom reaches everyone including the
      // socket that just joined (it's already in the room), with the current
      // authoritative state computed from the absolute phase_end_at — never
      // a relative "time left" that would drift from when the block started.
      broadcastRoom(io, db, location.id);
      broadcastLobby(io, db);
    });

    socket.on("room:start-focus", (payload?: { minutes?: number }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      startFocus(io, db, joinedLocationId, user.id, payload?.minutes ?? DEFAULT_FOCUS_MIN);
    });

    socket.on("room:start-lobby", () => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      startLobby(io, db, joinedLocationId, user.id);
    });

    socket.on("room:vote", (payload?: { minutes?: number }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null || typeof payload?.minutes !== "number") return;
      castVote(io, db, joinedLocationId, user.id, payload.minutes);
    });

    socket.on("room:reset", () => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      resetRoom(io, db, joinedLocationId, user.id);
    });

    socket.on("room:extend", (payload?: { minutes?: number }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      extendFocus(io, db, joinedLocationId, user.id, payload?.minutes ?? DEFAULT_FOCUS_MIN);
    });

    socket.on("room:goal-add", (payload?: { body?: string }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      const state = getRoomState(db, joinedLocationId);
      if (state.status !== "idle") return;
      const trimmed = (payload?.body ?? "").trim().slice(0, 200);
      if (!trimmed) return;
      addRoomGoal(db, joinedLocationId, trimmed, user.id);
      broadcastRoom(io, db, joinedLocationId);
    });

    socket.on("room:goal-toggle", (payload?: { id?: number }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null || typeof payload?.id !== "number") return;
      toggleRoomGoal(db, payload.id, joinedLocationId);
      broadcastRoom(io, db, joinedLocationId);
    });

    socket.on("room:goal-delete", (payload?: { id?: number }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null || typeof payload?.id !== "number") return;
      const state = getRoomState(db, joinedLocationId);
      if (state.status !== "idle") return;
      if (!deleteRoomGoal(db, payload.id, user.id)) return;
      broadcastRoom(io, db, joinedLocationId);
    });

    socket.on("chat:send", ({ body }: { body: string }) => {
      const user: Identity | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      const state = getRoomState(db, joinedLocationId);
      // Enforced here, server-side, regardless of what the sender's own UI
      // shows — a client that ignores its own disabled input still can't
      // chat. Review is deliberately left open by this check (it only blocks
      // "focus") — review is exactly the moment people should be talking
      // about what they did.
      if (state.status === "focus") return;
      const trimmed = body.trim().slice(0, 500);
      if (!trimmed) return;
      db.prepare(
        "INSERT INTO chat_messages (location_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
      ).run(joinedLocationId, user.id, trimmed, Date.now());
      io.to(roomName(joinedLocationId)).emit("chat:message", {
        username: user.username,
        body: trimmed,
        createdAt: Date.now(),
      });
    });

    socket.on("disconnect", () => {
      if (joinedLocationId !== null) leaveRoom(io, db, socket, joinedLocationId);
    });
  });
}

function leaveRoom(io: Server, db: DatabaseSync, socket: Socket, locationId: number): void {
  presence.get(locationId)?.delete(socket.id);
  socket.leave(roomName(locationId));
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}
