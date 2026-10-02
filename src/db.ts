import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: number;
  focus_minutes_total: number;
}

export interface Location {
  id: number;
  slug: string;
  name: string;
}

export type RoomStatus = "idle" | "focus" | "break";

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
