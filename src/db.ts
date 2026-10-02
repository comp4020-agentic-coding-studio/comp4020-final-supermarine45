import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface User {
  id: number;
  username: string;
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
  started_by: number | null;
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
  `);
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
    "UPDATE room_state SET status = 'idle', phase_end_at = NULL, started_by = NULL " +
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
      "SELECT location_id, status, phase_end_at, started_by FROM room_state WHERE location_id = ?",
    )
    .get(locationId) as unknown as RoomState;
}
