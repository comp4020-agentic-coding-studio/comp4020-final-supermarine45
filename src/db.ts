import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// The minimal shape a room/timer/chat/roster cares about — satisfied by both
// a real, persisted User and a zero-persistence guest identity (see
// isGuest()), so rooms.ts can treat them interchangeably.
export interface Identity {
  id: number;
  username: string;
  focus_minutes_total: number;
}

export interface User extends Identity {
  email: string;
  password_hash: string;
  salt: string;
  created_at: number;
}

// Guest identities are allocated negative ids (see auth.ts) specifically so
// they can never collide with a real users.id (AUTOINCREMENT, always >= 1).
export function isGuest(id: number): boolean {
  return id < 0;
}

export interface Location {
  id: number;
  slug: string;
  name: string;
}

export type RoomStatus = "idle" | "focus" | "review" | "break";

export interface RoomState {
  location_id: number;
  status: RoomStatus;
  phase_end_at: number | null;
  phase_started_at: number | null;
  duration_ms: number | null;
  started_by: number | null;
}

export interface ScheduledSession {
  id: number;
  locationId: number;
  username: string;
  startsAt: number;
}

export interface UpcomingSessionForUser {
  id: number;
  locationSlug: string;
  locationName: string;
  startsAt: number;
}

export interface RoomGoal {
  id: number;
  locationId: number;
  body: string;
  done: boolean;
  createdBy: number;
}

const SEED_ENCOURAGEMENTS: string[] = [
  "Still here. Still reading.",
  "Halfway. Don't check your phone.",
  "This is the boring part. That's the point.",
  "Nobody's watching, and everybody's watching.",
  "The clock doesn't care, but it's keeping you honest.",
  "You said you would. You are.",
  "Ten more minutes than you think you have left.",
  "This is what the room is for.",
  "Put it down. Pick the book back up.",
  "Nothing's happening, and that's working.",
  "The chat opens soon. The page doesn't turn itself.",
  "You're not behind. You're here.",
  "Quiet is doing its job.",
  "Whatever it is, it can wait five more minutes.",
  "This counts. All of it.",
  "The room is watching the same second you are.",
  "Still reading beats almost reading.",
  "One more paragraph. Then another.",
  "The timer doesn't negotiate. Neither should you.",
  "You showed up. That was the hard part.",
  "Keep going. Nobody else in this room has stopped either.",
  "This is the part that actually matters.",
  "Boredom is not an emergency.",
  "Later is not now. Now is now.",
];

const SEED_LOCATIONS: Array<{ slug: string; name: string }> = [
  { slug: "marie-reay", name: "Marie Reay Teaching Centre (Level 3)" },
  { slug: "chifley", name: "Chifley Library (Floor 4)" },
  { slug: "hancock", name: "Hancock Library (Basement)" },
  { slug: "menzies", name: "Menzies Library" },
  { slug: "law", name: "Law Library" },
];

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  seed(db);
  seedEncouragements(db);
  reconcileRoomStates(db);
  return db;
}

// Adds a column to an existing table only if it isn't already there, so
// migrate() stays safe to run against both a brand-new DB and an older local
// one that predates a given column.
function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      focus_minutes_total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_state (
      location_id INTEGER PRIMARY KEY REFERENCES locations(id),
      status TEXT NOT NULL DEFAULT 'idle',
      phase_end_at INTEGER,
      started_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      starts_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      body TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS encouragements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    );
  `);

  ensureColumn(db, "users", "email", "email TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)");
  ensureColumn(db, "room_state", "duration_ms", "duration_ms INTEGER");
  ensureColumn(db, "room_state", "phase_started_at", "phase_started_at INTEGER");
}

function seed(db: DatabaseSync): void {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM locations").get() as {
    count: number;
  };
  if (count > 0) return;

  const insertLocation = db.prepare("INSERT INTO locations (slug, name) VALUES (?, ?)");
  const insertRoomState = db.prepare(
    "INSERT INTO room_state (location_id, status) VALUES (?, 'idle')",
  );
  for (const location of SEED_LOCATIONS) {
    const result = insertLocation.run(location.slug, location.name);
    insertRoomState.run(result.lastInsertRowid);
  }
}

function seedEncouragements(db: DatabaseSync): void {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM encouragements").get() as {
    count: number;
  };
  if (count > 0) return;
  const insert = db.prepare("INSERT INTO encouragements (body) VALUES (?)");
  for (const body of SEED_ENCOURAGEMENTS) insert.run(body);
}

// After a restart, a phase whose end time has already passed must not be
// presented as still running — self-heal to idle rather than wedge the room.
function reconcileRoomStates(db: DatabaseSync): void {
  const now = Date.now();
  db.prepare(
    "UPDATE room_state SET status = 'idle', phase_end_at = NULL, phase_started_at = NULL, " +
      "duration_ms = NULL, started_by = NULL " +
      "WHERE status != 'idle' AND phase_end_at IS NOT NULL AND phase_end_at <= ?",
  ).run(now);
}

export function listLocations(db: DatabaseSync): Location[] {
  return db.prepare("SELECT id, slug, name FROM locations ORDER BY id").all() as unknown as Location[];
}

export function getLocationBySlug(db: DatabaseSync, slug: string): Location | undefined {
  return db.prepare("SELECT id, slug, name FROM locations WHERE slug = ?").get(slug) as unknown as
    | Location
    | undefined;
}

export function getRoomState(db: DatabaseSync, locationId: number): RoomState {
  return db
    .prepare(
      "SELECT location_id, status, phase_end_at, phase_started_at, duration_ms, started_by " +
        "FROM room_state WHERE location_id = ?",
    )
    .get(locationId) as unknown as RoomState;
}

export function createScheduledSession(
  db: DatabaseSync,
  locationId: number,
  userId: number,
  startsAt: number,
): void {
  db.prepare(
    "INSERT INTO scheduled_sessions (location_id, user_id, starts_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(locationId, userId, startsAt, Date.now());
}

export function listUpcomingSessions(db: DatabaseSync, locationId: number): ScheduledSession[] {
  return db
    .prepare(
      "SELECT scheduled_sessions.id AS id, scheduled_sessions.location_id AS locationId, " +
        "scheduled_sessions.starts_at AS startsAt, users.username AS username " +
        "FROM scheduled_sessions JOIN users ON users.id = scheduled_sessions.user_id " +
        "WHERE location_id = ? AND starts_at > ? ORDER BY starts_at ASC LIMIT 20",
    )
    .all(locationId, Date.now()) as unknown as ScheduledSession[];
}

// Deletes only if owned by userId; returns the freed session's locationId
// (so the caller can re-broadcast that room) or undefined if nothing matched.
export function deleteScheduledSession(db: DatabaseSync, id: number, userId: number): number | undefined {
  const row = db
    .prepare("SELECT location_id AS locationId FROM scheduled_sessions WHERE id = ? AND user_id = ?")
    .get(id, userId) as unknown as { locationId: number } | undefined;
  if (!row) return undefined;
  db.prepare("DELETE FROM scheduled_sessions WHERE id = ?").run(id);
  return row.locationId;
}

// A user's own upcoming bookings across every location, not just the one
// room they're currently in — the single place "what have I booked" is
// actually answered.
export function listUpcomingSessionsForUser(db: DatabaseSync, userId: number): UpcomingSessionForUser[] {
  return db
    .prepare(
      "SELECT scheduled_sessions.id AS id, locations.slug AS locationSlug, locations.name AS locationName, " +
        "scheduled_sessions.starts_at AS startsAt " +
        "FROM scheduled_sessions JOIN locations ON locations.id = scheduled_sessions.location_id " +
        "WHERE scheduled_sessions.user_id = ? AND starts_at > ? ORDER BY starts_at ASC LIMIT 50",
    )
    .all(userId, Date.now()) as unknown as UpcomingSessionForUser[];
}

export function countUpcomingSessions(db: DatabaseSync, locationId: number): number {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM scheduled_sessions WHERE location_id = ? AND starts_at > ?")
    .get(locationId, Date.now()) as { count: number };
  return count;
}

export function randomEncouragement(db: DatabaseSync): string | undefined {
  const row = db.prepare("SELECT body FROM encouragements ORDER BY RANDOM() LIMIT 1").get() as unknown as
    | { body: string }
    | undefined;
  return row?.body;
}

export function addRoomGoal(db: DatabaseSync, locationId: number, body: string, createdBy: number): void {
  db.prepare(
    "INSERT INTO room_goals (location_id, body, done, created_by, created_at) VALUES (?, ?, 0, ?, ?)",
  ).run(locationId, body, createdBy, Date.now());
}

export function listRoomGoals(db: DatabaseSync, locationId: number): RoomGoal[] {
  const rows = db
    .prepare(
      "SELECT id, location_id AS locationId, body, done, created_by AS createdBy FROM room_goals " +
        "WHERE location_id = ? ORDER BY id ASC",
    )
    .all(locationId) as unknown as Array<{
    id: number;
    locationId: number;
    body: string;
    done: number;
    createdBy: number;
  }>;
  return rows.map((r) => ({ ...r, done: r.done === 1 }));
}

// Flips done regardless of current value, scoped to locationId so a stray id
// from another room can't be toggled.
export function toggleRoomGoal(db: DatabaseSync, id: number, locationId: number): void {
  db.prepare(
    "UPDATE room_goals SET done = CASE WHEN done = 1 THEN 0 ELSE 1 END WHERE id = ? AND location_id = ?",
  ).run(id, locationId);
}

// Owner-only, matching deleteScheduledSession's pattern — returns whether
// anything was actually deleted.
export function deleteRoomGoal(db: DatabaseSync, id: number, requesterId: number): boolean {
  const result = db.prepare("DELETE FROM room_goals WHERE id = ? AND created_by = ?").run(id, requesterId);
  return result.changes > 0;
}

export function clearRoomGoals(db: DatabaseSync, locationId: number): void {
  db.prepare("DELETE FROM room_goals WHERE location_id = ?").run(locationId);
}

// Locations where this user's cycle is still running (not idle) — used by
// account deletion to force those rooms back to idle before the user row
// disappears, so started_by never dangles.
export function locationsStartedBy(db: DatabaseSync, userId: number): number[] {
  const rows = db
    .prepare("SELECT location_id AS locationId FROM room_state WHERE started_by = ? AND status != 'idle'")
    .all(userId) as unknown as Array<{ locationId: number }>;
  return rows.map((r) => r.locationId);
}

export function findUserById(db: DatabaseSync, id: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as User | undefined;
}

// Returns the distinct locationIds that had a booking from this user, so the
// caller can re-broadcast each after the rows are gone.
export function deleteUserScheduledSessions(db: DatabaseSync, userId: number): number[] {
  const rows = db
    .prepare("SELECT DISTINCT location_id AS locationId FROM scheduled_sessions WHERE user_id = ?")
    .all(userId) as unknown as Array<{ locationId: number }>;
  db.prepare("DELETE FROM scheduled_sessions WHERE user_id = ?").run(userId);
  return rows.map((r) => r.locationId);
}

export function deleteUserChatMessages(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM chat_messages WHERE user_id = ?").run(userId);
}

export function deleteUserSessions(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteUserRow(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}
