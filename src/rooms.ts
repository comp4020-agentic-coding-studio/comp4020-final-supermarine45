import type { DatabaseSync } from "node:sqlite";
import type { Server, Socket } from "socket.io";
import type { Location, RoomStatus, User } from "./db.js";
import { getLocationBySlug, getRoomState, listLocations, listUpcomingSessions } from "./db.js";

export const FOCUS_PRESETS_MIN = [15, 25, 45, 50] as const;
export const DEFAULT_FOCUS_MIN = 25;
export const BREAK_DURATION_MS = 5 * 60 * 1000;

interface Presence {
  socketId: string;
  user: User;
  joinedAt: number;
}

interface TimerPayload {
  status: RoomStatus;
  phaseEndAt: number | null;
  durationMs: number | null;
  startedByUsername: string | null;
}

interface RosterEntry {
  username: string;
  focusMinutesTotal: number;
  active: boolean;
}

// location_id -> socketId -> presence. In-memory: who's actually connected
// right now. room_state in the DB is the durable, authoritative timer state.
const presence = new Map<number, Map<string, Presence>>();
const scheduledTransitions = new Map<number, NodeJS.Timeout>();

function roomName(locationId: number): string {
  return `room:${locationId}`;
}

function timerPayload(db: DatabaseSync, locationId: number): TimerPayload {
  const state = getRoomState(db, locationId);
  const durationMs = state.status === "idle" ? null : state.duration_ms;
  let startedByUsername: string | null = null;
  if (state.status !== "idle" && state.started_by !== null) {
    const row = db.prepare("SELECT username FROM users WHERE id = ?").get(state.started_by) as unknown as
      | { username: string }
      | undefined;
    startedByUsername = row?.username ?? null;
  }
  return { status: state.status, phaseEndAt: state.phase_end_at, durationMs, startedByUsername };
}

function roster(locationId: number): RosterEntry[] {
  const room = presence.get(locationId);
  if (!room) return [];
  return [...room.values()].map((p) => ({
    username: p.user.username,
    focusMinutesTotal: p.user.focus_minutes_total,
    active: true,
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
      occupants: occupancy(location.id),
      active: state.status === "focus",
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
  });
}

// cutoff caps how far past phaseStartedAt a user's overlap can count — the
// full block length on a normal transition, or "now" when a reset ends a
// block early, so only actually-elapsed time is ever awarded.
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

function schedule(io: Server, db: DatabaseSync, locationId: number, delayMs: number): void {
  clearSchedule(locationId);
  const timeout = setTimeout(() => advancePhase(io, db, locationId), Math.max(delayMs, 0));
  timeout.unref();
  scheduledTransitions.set(locationId, timeout);
}

function advancePhase(io: Server, db: DatabaseSync, locationId: number): void {
  const state = getRoomState(db, locationId);
  if (state.status === "focus") {
    awardFocusMinutes(db, locationId, state.phase_started_at!, state.duration_ms!);
    const now = Date.now();
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
  }
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

// On boot, any room still mid-focus/break (phase_end_at in the future — an
// already-expired one was already reconciled to idle in db.ts) lost its
// in-memory setTimeout to the restart and must have it re-armed, or it would
// stay wedged in that phase forever once the clock runs out.
export function rearmTimers(io: Server, db: DatabaseSync): void {
  const now = Date.now();
  const rows = db
    .prepare("SELECT location_id AS locationId, phase_end_at AS phaseEndAt FROM room_state WHERE status != 'idle' AND phase_end_at IS NOT NULL")
    .all() as unknown as Array<{ locationId: number; phaseEndAt: number }>;
  for (const row of rows) {
    schedule(io, db, row.locationId, Math.max(row.phaseEndAt - now, 0));
  }
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
  const now = Date.now();
  const durationMs = minutes * 60_000;
  db.prepare(
    "UPDATE room_state SET status = 'focus', phase_end_at = ?, phase_started_at = ?, duration_ms = ?, " +
      "started_by = ? WHERE location_id = ?",
  ).run(now + durationMs, now, durationMs, userId, locationId);
  schedule(io, db, locationId, durationMs);
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

// Only the person who started a cycle can end it early — restricted to avoid
// one user cutting off everyone else's focus block now that lengths vary.
export function resetRoom(io: Server, db: DatabaseSync, locationId: number, userId: number): void {
  const state = getRoomState(db, locationId);
  if (state.status === "idle") return;
  if (state.started_by !== userId) return;
  if (state.status === "focus") {
    awardFocusMinutes(db, locationId, state.phase_started_at!, Date.now() - state.phase_started_at!);
  }
  clearSchedule(locationId);
  db.prepare(
    "UPDATE room_state SET status = 'idle', phase_end_at = NULL, phase_started_at = NULL, " +
      "duration_ms = NULL, started_by = NULL WHERE location_id = ?",
  ).run(locationId);
  broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

export function registerSocketHandlers(io: Server, db: DatabaseSync): void {
  io.on("connection", (socket: Socket) => {
    socket.join("lobby");

    let joinedLocationId: number | null = null;

    socket.on("room:join", ({ slug }: { slug: string }) => {
      const user: User | undefined = socket.data.user;
      if (!user) {
        socket.emit("room:error", "sign in required");
        return;
      }
      const location: Location | undefined = getLocationBySlug(db, slug);
      if (!location) {
        socket.emit("room:error", "unknown location");
        return;
      }
      if (joinedLocationId !== null) leaveRoom(io, db, socket, joinedLocationId);

      joinedLocationId = location.id;
      socket.join(roomName(location.id));
      if (!presence.has(location.id)) presence.set(location.id, new Map());
      presence.get(location.id)!.set(socket.id, { socketId: socket.id, user, joinedAt: Date.now() });

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
      const user: User | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      startFocus(io, db, joinedLocationId, user.id, payload?.minutes ?? DEFAULT_FOCUS_MIN);
    });

    socket.on("room:reset", () => {
      const user: User | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      resetRoom(io, db, joinedLocationId, user.id);
    });

    socket.on("chat:send", ({ body }: { body: string }) => {
      const user: User | undefined = socket.data.user;
      if (!user || joinedLocationId === null) return;
      const state = getRoomState(db, joinedLocationId);
      // Enforced here, server-side, regardless of what the sender's own UI
      // shows — a client that ignores its own disabled input still can't chat.
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
