import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// The minimal shape a table/timer/roster cares about — satisfied by both a
// real, persisted User and a zero-persistence guest identity (see isGuest()),
// so rooms.ts can treat them interchangeably.
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
  chime_enabled: number;
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
  buildingSlug: string;
  buildingName: string;
}

// The 4 cognitive modes a student picks alongside a library hub. A "Table" is
// keyed by (hub, mode) jointly — see room_state below — so up to 4 of these
// can run concurrently at one hub, each with its own roster and timer.
export type ActivityMode = "silent" | "writing" | "pitch" | "problem";
export const ACTIVITY_MODES: readonly ActivityMode[] = ["silent", "writing", "pitch", "problem"];

export type RoomStatus = "idle" | "focus" | "break";

export interface RoomState {
  locationId: number;
  activityMode: ActivityMode;
  status: RoomStatus;
  phaseStartedAt: number | null;
  phaseEndAt: number | null;
  durationMs: number | null;
  // Lifetime count of focus blocks that resolved with at least one ticket at
  // this (location, mode) table — "rolled over" in the Library Stats sense,
  // bumped once per cycle in endFocus (src/rooms.ts). Never reset.
  lastActiveRollovers: number;
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

export type TicketStamp = "completed" | "partial" | "pivoted";

export interface Ticket {
  id: number;
  locationId: number;
  activityMode: ActivityMode;
  userId: number;
  // Snapshotted at submission time (and refreshed on re-submission) rather
  // than joined from users.username — a guest has no users row to join
  // against once they disconnect, and a ticket must still render a name
  // after that (same problem the old room_state.started_by had, solved the
  // same way via resolveStartedByUsername).
  username: string;
  cycleStartAt: number;
  body: string;
  stuck: boolean;
  // When `stuck` was last set true; null while not stuck. Separate from the
  // boolean (kept byte-for-byte for existing stuck-flag assertions) so the
  // Stuck Queue can render in the order people actually raised their hand.
  stuckAt: number | null;
  stamp: TicketStamp | null;
  stayedFullBlock: boolean;
  // Set the first time this ticket is pivoted (room:pivot-ticket); null for a
  // ticket that's never been pivoted. Drives both whether room:stamp-ticket
  // will accept stamp:"pivoted" and whether the Break Modal even offers that
  // button — see rooms.ts's room:pivot-ticket/room:stamp-ticket handlers.
  pivotedAt: number | null;
  // Null means the full table-wide FOCUS_DURATION_MS block (the default).
  // Set at board time (room:submit-ticket) to a shorter personal block the
  // user chose for themselves — this never changes the shared table timer
  // every other member sees, only what this one ticket's own progress
  // ring/nudge is measured against. See rooms.ts's PERSONAL_DURATION_PRESETS_MIN.
  personalDurationMs: number | null;
  createdAt: number;
}

export interface Kudos {
  id: number;
  ticketId: number;
  fromUserId: number;
  emoji: string;
  createdAt: number;
}

export type BuddyStatus = "pending" | "accepted";

export interface Buddy {
  id: number;
  requesterId: number;
  addresseeId: number;
  status: BuddyStatus;
  createdAt: number;
}

export interface HeatmapEntry {
  date: string;
  count: number;
}

export interface CognitiveDietEntry {
  mode: ActivityMode;
  count: number;
}

export interface HubStatsEntry {
  locationName: string;
  count: number;
}

export interface BuddyFeedEntry {
  ticketId: number;
  username: string;
  locationName: string;
  activityMode: ActivityMode;
  body: string;
  stamp: TicketStamp | null;
  cycleStartAt: number;
}

// Every ticket a user has ever submitted, not just VFH-qualifying ones (see
// getHeatmap/getCognitiveDiet) — history should show what actually happened,
// including a board-then-leave-early (stamp: null, stayedFullBlock: false).
export interface UserHistoryEntry {
  ticketId: number;
  locationSlug: string;
  locationName: string;
  activityMode: ActivityMode;
  body: string;
  stamp: TicketStamp | null;
  stayedFullBlock: boolean;
  cycleStartAt: number;
}

// Every ticket ever submitted at a location, regardless of who submitted it
// or whether it was VFH-qualifying — "what has this room seen." Username and
// mode are already snapshotted on the ticket row (Decision 7, see the
// tickets table comment), so no join to users is needed.
export interface LocationHistoryEntry {
  ticketId: number;
  username: string;
  activityMode: ActivityMode;
  body: string;
  stamp: TicketStamp | null;
  stayedFullBlock: boolean;
  cycleStartAt: number;
}

// A per-(user, hub, mode) reboard streak — separate from VFH. VFH certifies
// "I finished and checked out" for a single block; this certifies "I came
// back and did it again," purely from this one user's own behavior, with no
// group vote or quorum involved — it resets to 0 the moment they reboard
// without a qualifying stamp on their immediately-prior ticket at this table,
// or don't reboard at all.
export interface StreakEntry {
  locationName: string;
  activityMode: ActivityMode;
  currentStreak: number;
  longestStreak: number;
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

interface SeedLocation {
  slug: string;
  name: string;
  buildingSlug: string;
  buildingName: string;
}

// Every space is a real, walkable ANU place — hardcoded, never user-created
// (see CLAUDE.md's Location Strictness rule). Deliberately comprehensive
// rather than token-sized: the README used to cap this list at exactly five
// (one per building) as its expression of "removes choices, doesn't add
// them" — now the choice being removed is inventing or naming a room, not
// which real space within a real building to join. A few slugs
// (marie-reay, chifley, hancock, menzies, law) predate this list and are
// kept as-is so existing bookmarks/tests/sessions still resolve.
const SEED_LOCATIONS: SeedLocation[] = [
  // Chifley Library
  { slug: "chifley-lg", name: "Lower Ground Floor — Media & Computer Lab", buildingSlug: "chifley-library", buildingName: "Chifley Library" },
  { slug: "chifley-ground", name: "Ground Floor — Collaborative Commons", buildingSlug: "chifley-library", buildingName: "Chifley Library" },
  { slug: "chifley-l1", name: "Level 1 — Group Study Tables", buildingSlug: "chifley-library", buildingName: "Chifley Library" },
  { slug: "chifley-l2", name: "Level 2 — Quiet Reading Room", buildingSlug: "chifley-library", buildingName: "Chifley Library" },
  { slug: "chifley-l3", name: "Level 3 — Silent Study Floor", buildingSlug: "chifley-library", buildingName: "Chifley Library" },
  { slug: "chifley", name: "Level 4 — 24-Hour Study Room", buildingSlug: "chifley-library", buildingName: "Chifley Library" },
  // Hancock Library
  { slug: "hancock", name: "Basement — Silent Study", buildingSlug: "hancock-library", buildingName: "Hancock Library" },
  { slug: "hancock-ground", name: "Ground Floor — Reading Room", buildingSlug: "hancock-library", buildingName: "Hancock Library" },
  { slug: "hancock-l1", name: "Level 1 — Group Study Pods", buildingSlug: "hancock-library", buildingName: "Hancock Library" },
  { slug: "hancock-l2", name: "Level 2 — Quiet Floor", buildingSlug: "hancock-library", buildingName: "Hancock Library" },
  { slug: "hancock-l3", name: "Level 3 — Postgraduate Study Area", buildingSlug: "hancock-library", buildingName: "Hancock Library" },
  // Menzies Library
  { slug: "menzies", name: "Ground Floor — Asia-Pacific Reading Room", buildingSlug: "menzies-library", buildingName: "Menzies Library" },
  { slug: "menzies-l1", name: "Level 1 — Group Study Area", buildingSlug: "menzies-library", buildingName: "Menzies Library" },
  { slug: "menzies-l2", name: "Level 2 — Silent Study Floor", buildingSlug: "menzies-library", buildingName: "Menzies Library" },
  // Law Library
  { slug: "law", name: "Level 1 — Main Reading Room", buildingSlug: "law-library", buildingName: "Law Library" },
  { slug: "law-l2", name: "Level 2 — Silent Study", buildingSlug: "law-library", buildingName: "Law Library" },
  { slug: "law-l3", name: "Level 3 — Group Discussion Rooms", buildingSlug: "law-library", buildingName: "Law Library" },
  // Marie Reay Teaching Centre
  { slug: "marie-reay", name: "Level 3 — Flexible Learning Space", buildingSlug: "marie-reay-teaching-centre", buildingName: "Marie Reay Teaching Centre" },
  { slug: "marie-reay-l1", name: "Level 1 — Group Study Booths", buildingSlug: "marie-reay-teaching-centre", buildingName: "Marie Reay Teaching Centre" },
  { slug: "marie-reay-l2", name: "Level 2 — Quiet Corner", buildingSlug: "marie-reay-teaching-centre", buildingName: "Marie Reay Teaching Centre" },
  // Kambri Student Commons
  { slug: "kambri-l1", name: "Level 1 — Study Hub", buildingSlug: "kambri-student-commons", buildingName: "Kambri Student Commons" },
  { slug: "kambri-l2", name: "Level 2 — Group Pods", buildingSlug: "kambri-student-commons", buildingName: "Kambri Student Commons" },
  { slug: "kambri-quiet", name: "Quiet Room", buildingSlug: "kambri-student-commons", buildingName: "Kambri Student Commons" },
  // Hedley Bull Centre
  { slug: "hedley-common", name: "Common Room — Study Area", buildingSlug: "hedley-bull-centre", buildingName: "Hedley Bull Centre" },
  { slug: "hedley-l2", name: "Level 2 — Reading Nook", buildingSlug: "hedley-bull-centre", buildingName: "Hedley Bull Centre" },
  // R.N. Robertson Building
  { slug: "robertson-common", name: "Common Room — Study Area", buildingSlug: "rn-robertson-building", buildingName: "R.N. Robertson Building" },
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

// SQLite has no ALTER TABLE ... DROP CONSTRAINT, so removing a stale
// REFERENCES clause means recreating the table: copy its current columns
// (whatever they are — including any ensureColumn additions already applied
// to this specific file) into a table built from newTableSql, then swap it
// in. A no-op once the table no longer has the named FK, so safe to call on
// every startup.
function dropForeignKey(
  db: DatabaseSync,
  table: string,
  fkColumn: string,
  fkTargetTable: string,
  newTableSql: string,
): void {
  const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown as Array<{
    from: string;
    table: string;
  }>;
  if (!fks.some((fk) => fk.from === fkColumn && fk.table === fkTargetTable)) return;
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>)
    .map((c) => c.name)
    .join(", ");
  const tempTable = `__migrate_${table}`;
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(newTableSql.replace(new RegExp(`\\b${table}\\b`), tempTable));
    db.prepare(`INSERT INTO ${tempTable} (${columns}) SELECT ${columns} FROM ${table}`).run();
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${tempTable} RENAME TO ${table}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

// The old schema keyed room_state on location_id alone (one timer per hub).
// The Table model needs a composite (location_id, activity_mode) key instead
// — up to 4 independent tables per hub — which SQLite can't retrofit via
// ALTER TABLE. room_state only ever holds in-progress phase timing, never a
// user's own data, so unlike chat/goals/focus-minutes below there's nothing
// here worth preserving across the shape change: any row still mid-phase at
// upgrade time would already have been reset to idle by reconcileRoomStates
// under the old schema. Safe to call on every boot; a no-op once
// activity_mode already exists (including on a brand-new DB, where
// room_state doesn't exist yet and the CREATE TABLE below defines the new
// shape directly).
function migrateRoomStateToTableModel(db: DatabaseSync): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_state'")
    .all();
  if (tables.length === 0) return;
  const cols = db.prepare("PRAGMA table_info(room_state)").all() as unknown as Array<{ name: string }>;
  if (cols.some((c) => c.name === "activity_mode")) return;
  db.exec("DROP TABLE room_state");
}

function migrate(db: DatabaseSync): void {
  migrateRoomStateToTableModel(db);

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

    -- One row per (hub, mode) "Table". status: 'idle' | 'focus' | 'break'.
    -- No started_by: under the automatic hourly scheduler nobody owns a
    -- cycle, so nobody can start or cancel one early (see rooms.ts).
    CREATE TABLE IF NOT EXISTS room_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      activity_mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      phase_started_at INTEGER,
      phase_end_at INTEGER,
      duration_ms INTEGER,
      UNIQUE(location_id, activity_mode)
    );

    -- Unused since the Table-model redesign (chat is a hard "no" per
    -- CLAUDE.md's social-layer rules) — kept, not dropped, same
    -- no-destructive-migration posture as every other table here.
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      -- No REFERENCES users(id): a guest can chat, and has no users row to
      -- reference.
      user_id INTEGER NOT NULL,
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

    CREATE TABLE IF NOT EXISTS encouragements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    );

    -- A Deliverable Ticket: one per user per Table per hourly cycle. Mandatory
    -- to board a Table (see countBoardedTickets / the 6-cap in rooms.ts).
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      activity_mode TEXT NOT NULL,
      -- No REFERENCES users(id): guests submit tickets too (Decision 7) and
      -- have no users row to reference.
      user_id INTEGER NOT NULL,
      -- Snapshotted, not joined — see the Ticket interface's comment above.
      username TEXT NOT NULL,
      cycle_start_at INTEGER NOT NULL,
      body TEXT NOT NULL,
      stuck INTEGER NOT NULL DEFAULT 0,
      stamp TEXT,
      stayed_full_block INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(location_id, activity_mode, user_id, cycle_start_at)
    );

    -- An emoji reaction left on a ticket during the break window. One per
    -- (ticket, giver) pair.
    CREATE TABLE IF NOT EXISTS kudos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      -- No REFERENCES users(id): guests can give kudos too.
      from_user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(ticket_id, from_user_id)
    );

    -- A Strava-style buddy connection between two registered users. Requests
    -- and buddy visibility are gated to real users at the route layer
    -- (requireRealUser) — a guest identity has nothing durable to connect.
    CREATE TABLE IF NOT EXISTS buddies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      UNIQUE(requester_id, addressee_id)
    );

    -- A per-(user, hub, mode) reboard streak. Separate from VFH entirely —
    -- VFH certifies full-block presence+stamp for one block, this certifies
    -- "I personally came back and did it again," driven purely by this one
    -- user's own reboard+stamp history, no group vote involved. No FK on
    -- user_id: a guest identity never persists long enough to accrue one
    -- (same precedent as VFH's guest exclusion below), and callers skip
    -- guests before writing here.
    CREATE TABLE IF NOT EXISTS streaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      activity_mode TEXT NOT NULL,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, location_id, activity_mode)
    );
  `);

  dropForeignKey(
    db,
    "chat_messages",
    "user_id",
    "users",
    "CREATE TABLE chat_messages (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL REFERENCES locations(id), " +
      "user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)",
  );

  ensureColumn(db, "locations", "building_slug", "building_slug TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "locations", "building_name", "building_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "email", "email TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)");
  ensureColumn(db, "tickets", "stuck_at", "stuck_at INTEGER");
  ensureColumn(db, "users", "chime_enabled", "chime_enabled INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tickets", "pivoted_at", "pivoted_at INTEGER");
  ensureColumn(
    db,
    "room_state",
    "last_active_rollovers",
    "last_active_rollovers INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(db, "tickets", "personal_duration_ms", "personal_duration_ms INTEGER");
}

// Insert-or-ignore per (slug, mode), rather than bailing out once any row
// exists, so growing SEED_LOCATIONS or ACTIVITY_MODES adds the new
// rows to an already-seeded DB — prod's SQLite file lives on a persistent Fly
// volume, not a fresh one per deploy.
function seed(db: DatabaseSync): void {
  const insertLocation = db.prepare(
    "INSERT OR IGNORE INTO locations (slug, name, building_slug, building_name) VALUES (?, ?, ?, ?)",
  );
  const insertRoomState = db.prepare(
    "INSERT OR IGNORE INTO room_state (location_id, activity_mode, status) VALUES (?, ?, 'idle')",
  );
  const backfillBuilding = db.prepare(
    "UPDATE locations SET name = ?, building_slug = ?, building_name = ? " +
      "WHERE slug = ? AND building_slug = ''",
  );
  const findId = db.prepare("SELECT id FROM locations WHERE slug = ?");
  for (const location of SEED_LOCATIONS) {
    insertLocation.run(location.slug, location.name, location.buildingSlug, location.buildingName);
    // Rows from before buildings existed have a blank building_slug — bring
    // them up to date with their (possibly renamed) current seed entry.
    backfillBuilding.run(location.name, location.buildingSlug, location.buildingName, location.slug);
    const row = findId.get(location.slug) as unknown as { id: number };
    for (const mode of ACTIVITY_MODES) {
      insertRoomState.run(row.id, mode);
    }
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
// presented as still running — self-heal to idle rather than wedge the table.
function reconcileRoomStates(db: DatabaseSync): void {
  const now = Date.now();
  db.prepare(
    "UPDATE room_state SET status = 'idle', phase_end_at = NULL, phase_started_at = NULL, duration_ms = NULL " +
      "WHERE status != 'idle' AND phase_end_at IS NOT NULL AND phase_end_at <= ?",
  ).run(now);
}

const LOCATION_COLUMNS =
  "id, slug, name, building_slug AS buildingSlug, building_name AS buildingName";

export function listLocations(db: DatabaseSync): Location[] {
  return db
    .prepare(`SELECT ${LOCATION_COLUMNS} FROM locations ORDER BY building_name, id`)
    .all() as unknown as Location[];
}

export function getLocationBySlug(db: DatabaseSync, slug: string): Location | undefined {
  return db.prepare(`SELECT ${LOCATION_COLUMNS} FROM locations WHERE slug = ?`).get(slug) as unknown as
    | Location
    | undefined;
}

export function getLocationById(db: DatabaseSync, id: number): Location | undefined {
  return db.prepare(`SELECT ${LOCATION_COLUMNS} FROM locations WHERE id = ?`).get(id) as unknown as
    | Location
    | undefined;
}

const ROOM_STATE_COLUMNS =
  "location_id AS locationId, activity_mode AS activityMode, status, " +
  "phase_started_at AS phaseStartedAt, phase_end_at AS phaseEndAt, duration_ms AS durationMs, " +
  "last_active_rollovers AS lastActiveRollovers";

// Plain select, assumes the row exists — safe because seed() eagerly creates
// every (location, mode) pair at boot (104 rows today: 26 hubs × 4 modes),
// the same guarantee getRoomState relied on for the old one-row-per-hub
// shape.
export function getTable(db: DatabaseSync, locationId: number, mode: ActivityMode): RoomState {
  return db
    .prepare(`SELECT ${ROOM_STATE_COLUMNS} FROM room_state WHERE location_id = ? AND activity_mode = ?`)
    .get(locationId, mode) as unknown as RoomState;
}

// Defensive convenience over getTable for callers that can't assume seed()
// already ran for this exact pair (e.g. a location/mode added without a
// server restart) — insert-or-ignore then select, same idempotent-on-every-
// call shape as the rest of this file's upsert-style helpers.
export function getOrCreateTable(db: DatabaseSync, locationId: number, mode: ActivityMode): RoomState {
  db.prepare("INSERT OR IGNORE INTO room_state (location_id, activity_mode, status) VALUES (?, ?, 'idle')").run(
    locationId,
    mode,
  );
  return getTable(db, locationId, mode);
}

// The only writer of a table's phase fields — every transition (scheduler
// firing, focus->break, break->idle) goes through this one function, mirroring
// the single-writer convention every other mutable row in this file follows.
export function setTableState(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  status: RoomStatus,
  phaseStartedAt: number | null,
  phaseEndAt: number | null,
  durationMs: number | null,
): void {
  db.prepare(
    "UPDATE room_state SET status = ?, phase_started_at = ?, phase_end_at = ?, duration_ms = ? " +
      "WHERE location_id = ? AND activity_mode = ?",
  ).run(status, phaseStartedAt, phaseEndAt, durationMs, locationId, mode);
}

// Bumps the Library Stats "rolled over N times" counter — called once per
// focus block that resolves (rooms.ts's endFocus), which by construction only
// ever runs for a block that had at least one boarded ticket (beginScheduledFocus
// never transitions an empty cycle into focus), so no extra guard is needed here.
export function incrementTableRollovers(db: DatabaseSync, locationId: number, mode: ActivityMode): void {
  db.prepare(
    "UPDATE room_state SET last_active_rollovers = last_active_rollovers + 1 " +
      "WHERE location_id = ? AND activity_mode = ?",
  ).run(locationId, mode);
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

// --- tickets ---

const TICKET_COLUMNS =
  "id, location_id AS locationId, activity_mode AS activityMode, user_id AS userId, username, " +
  "cycle_start_at AS cycleStartAt, body, stuck, stuck_at AS stuckAt, stamp, " +
  "stayed_full_block AS stayedFullBlock, pivoted_at AS pivotedAt, " +
  "personal_duration_ms AS personalDurationMs, created_at AS createdAt";

type TicketRow = Omit<Ticket, "stuck" | "stayedFullBlock"> & { stuck: number; stayedFullBlock: number };

function toTicket(row: TicketRow): Ticket {
  return { ...row, stuck: row.stuck === 1, stayedFullBlock: row.stayedFullBlock === 1 };
}

// Insert-or-update: submitting again before boarding just edits the same
// cycle's ticket body (and refreshes username, in case a real user renamed
// since) in place — stuck/stamp/stayedFullBlock are untouched by the DO
// UPDATE, so editing a ticket never resets flags already set on it.
// personalDurationMs is re-applied on every submit (like body) since it's
// chosen alongside the body on the same board-time form — null means the
// full shared TABLE_CYCLE_MS-derived block, never a change to that shared
// timer itself (see rooms.ts's room:submit-ticket).
export function upsertTicket(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  username: string,
  cycleStartAt: number,
  body: string,
  personalDurationMs: number | null = null,
): void {
  db.prepare(
    "INSERT INTO tickets (location_id, activity_mode, user_id, username, cycle_start_at, body, personal_duration_ms, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(location_id, activity_mode, user_id, cycle_start_at) " +
      "DO UPDATE SET body = excluded.body, username = excluded.username, personal_duration_ms = excluded.personal_duration_ms",
  ).run(locationId, mode, userId, username, cycleStartAt, body, personalDurationMs, Date.now());
}

export function getTicket(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  cycleStartAt: number,
): Ticket | undefined {
  const row = db
    .prepare(
      `SELECT ${TICKET_COLUMNS} FROM tickets ` +
        "WHERE location_id = ? AND activity_mode = ? AND user_id = ? AND cycle_start_at = ?",
    )
    .get(locationId, mode, userId, cycleStartAt) as unknown as TicketRow | undefined;
  return row ? toTicket(row) : undefined;
}

// Every boarded ticket for one Table's current cycle, in submission order —
// what the Table Dashboard renders as up-to-6 ticket cards.
export function listTickets(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  cycleStartAt: number,
): Ticket[] {
  const rows = db
    .prepare(
      `SELECT ${TICKET_COLUMNS} FROM tickets ` +
        "WHERE location_id = ? AND activity_mode = ? AND cycle_start_at = ? ORDER BY id ASC",
    )
    .all(locationId, mode, cycleStartAt) as unknown as TicketRow[];
  return rows.map(toTicket);
}

export function countBoardedTickets(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  cycleStartAt: number,
): number {
  const { count } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM tickets WHERE location_id = ? AND activity_mode = ? AND cycle_start_at = ?",
    )
    .get(locationId, mode, cycleStartAt) as { count: number };
  return count;
}

// This user's most recent ticket at this table strictly before the given
// cycle — used to decide whether a reboard continues their streak (rooms.ts'
// room:submit-ticket handler). Not scoped to "the immediately previous
// cycle" by timestamp arithmetic, since cycle length can change (test speed
// overrides) and a table can sit idle between cycles; "most recent prior
// ticket at this table" is what "did you come back and finish last time"
// actually means.
export function getPreviousTicket(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  beforeCycleStartAt: number,
): Ticket | undefined {
  const row = db
    .prepare(
      `SELECT ${TICKET_COLUMNS} FROM tickets ` +
        "WHERE location_id = ? AND activity_mode = ? AND user_id = ? AND cycle_start_at < ? " +
        "ORDER BY cycle_start_at DESC LIMIT 1",
    )
    .get(locationId, mode, userId, beforeCycleStartAt) as unknown as TicketRow | undefined;
  return row ? toTicket(row) : undefined;
}

export function toggleStuck(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  cycleStartAt: number,
): void {
  db.prepare(
    "UPDATE tickets SET stuck = CASE WHEN stuck = 1 THEN 0 ELSE 1 END, " +
      "stuck_at = CASE WHEN stuck = 1 THEN NULL ELSE ? END " +
      "WHERE location_id = ? AND activity_mode = ? AND user_id = ? AND cycle_start_at = ?",
  ).run(Date.now(), locationId, mode, userId, cycleStartAt);
}

export function stampTicket(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  cycleStartAt: number,
  stamp: TicketStamp,
): void {
  db.prepare(
    "UPDATE tickets SET stamp = ? WHERE location_id = ? AND activity_mode = ? AND user_id = ? AND cycle_start_at = ?",
  ).run(stamp, locationId, mode, userId, cycleStartAt);
}

// Rewrites a ticket's body mid-focus (Pivot Goal) and stamps pivoted_at the
// first time this happens — pivoted_at, once set, never clears, since it
// exists purely to answer "was this ticket ever pivoted" for room:stamp-ticket
// and the Break Modal's third button.
export function pivotTicket(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  cycleStartAt: number,
  body: string,
): void {
  db.prepare(
    "UPDATE tickets SET body = ?, pivoted_at = COALESCE(pivoted_at, ?) " +
      "WHERE location_id = ? AND activity_mode = ? AND user_id = ? AND cycle_start_at = ?",
  ).run(body, Date.now(), locationId, mode, userId, cycleStartAt);
}

// Called from the tab-penalty demotion path (rooms.ts) so a user demoted
// mid-block can never earn VFH for this cycle even if they reconnect and
// stamp afterward — VFH certifies full-block presence, not just an
// honest-at-the-end checkout.
export function markTicketNotFullBlock(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  userId: number,
  cycleStartAt: number,
): void {
  db.prepare(
    "UPDATE tickets SET stayed_full_block = 0 " +
      "WHERE location_id = ? AND activity_mode = ? AND user_id = ? AND cycle_start_at = ?",
  ).run(locationId, mode, userId, cycleStartAt);
}

// --- kudos ---

// INSERT OR IGNORE against the (ticket_id, from_user_id) UNIQUE constraint,
// so a duplicate or self-kudos attempt (self-kudos is blocked by the caller
// before this runs) silently no-ops instead of throwing. The boolean return
// lets the caller decide whether to broadcast.
export function addKudos(db: DatabaseSync, ticketId: number, fromUserId: number, emoji: string): boolean {
  const result = db
    .prepare("INSERT OR IGNORE INTO kudos (ticket_id, from_user_id, emoji, created_at) VALUES (?, ?, ?, ?)")
    .run(ticketId, fromUserId, emoji, Date.now());
  return result.changes > 0;
}

export function getKudosForTicket(db: DatabaseSync, ticketId: number): Kudos[] {
  return db
    .prepare(
      "SELECT id, ticket_id AS ticketId, from_user_id AS fromUserId, emoji, created_at AS createdAt " +
        "FROM kudos WHERE ticket_id = ? ORDER BY id ASC",
    )
    .all(ticketId) as unknown as Kudos[];
}

// --- streaks (reboard) ---

// Raw current_streak, 0 if no row exists yet — unlike listStreaksForUser
// (which only surfaces streaks > 0 for profile display), this returns the
// true value including a just-reset 0, so tests can assert a reset actually
// happened rather than merely "isn't listed."
export function getStreak(db: DatabaseSync, userId: number, locationId: number, mode: ActivityMode): number {
  const row = db
    .prepare(
      "SELECT current_streak AS currentStreak FROM streaks " +
        "WHERE user_id = ? AND location_id = ? AND activity_mode = ?",
    )
    .get(userId, locationId, mode) as unknown as { currentStreak: number } | undefined;
  return row?.currentStreak ?? 0;
}

// Guests (isGuest(userId)) are never passed here — callers skip them before
// calling, same exclusion precedent as VFH.
export function incrementStreak(db: DatabaseSync, userId: number, locationId: number, mode: ActivityMode): void {
  db.prepare(
    "INSERT INTO streaks (user_id, location_id, activity_mode, current_streak, longest_streak, updated_at) " +
      "VALUES (?, ?, ?, 1, 1, ?) " +
      "ON CONFLICT(user_id, location_id, activity_mode) DO UPDATE SET " +
      "current_streak = current_streak + 1, " +
      "longest_streak = MAX(longest_streak, current_streak + 1), " +
      "updated_at = excluded.updated_at",
  ).run(userId, locationId, mode, Date.now());
}

export function resetStreak(db: DatabaseSync, userId: number, locationId: number, mode: ActivityMode): void {
  db.prepare(
    "INSERT INTO streaks (user_id, location_id, activity_mode, current_streak, longest_streak, updated_at) " +
      "VALUES (?, ?, ?, 0, 0, ?) " +
      "ON CONFLICT(user_id, location_id, activity_mode) DO UPDATE SET " +
      "current_streak = 0, updated_at = excluded.updated_at",
  ).run(userId, locationId, mode, Date.now());
}

export function listStreaksForUser(db: DatabaseSync, userId: number): StreakEntry[] {
  return db
    .prepare(
      "SELECT locations.name AS locationName, streaks.activity_mode AS activityMode, " +
        "streaks.current_streak AS currentStreak, streaks.longest_streak AS longestStreak " +
        "FROM streaks JOIN locations ON locations.id = streaks.location_id " +
        "WHERE streaks.user_id = ? AND streaks.current_streak > 0 " +
        "ORDER BY streaks.current_streak DESC",
    )
    .all(userId) as unknown as StreakEntry[];
}

// --- Verified Focus Hours & profile stats ---

// 1 VFH per ticket that both stayed the full block and was stamped at
// checkout — binary per block, never partial-minute (Decision 5).
export function getVfhCount(db: DatabaseSync, userId: number): number {
  const { count } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM tickets WHERE user_id = ? AND stamp IS NOT NULL AND stayed_full_block = 1",
    )
    .get(userId) as { count: number };
  return count;
}

export function getHeatmap(db: DatabaseSync, userId: number, sinceEpochMs: number): HeatmapEntry[] {
  return db
    .prepare(
      "SELECT DATE(cycle_start_at / 1000, 'unixepoch') AS date, COUNT(*) AS count FROM tickets " +
        "WHERE user_id = ? AND stamp IS NOT NULL AND stayed_full_block = 1 AND cycle_start_at >= ? " +
        "GROUP BY date ORDER BY date ASC",
    )
    .all(userId, sinceEpochMs) as unknown as HeatmapEntry[];
}

export function getCognitiveDiet(db: DatabaseSync, userId: number): CognitiveDietEntry[] {
  return db
    .prepare(
      "SELECT activity_mode AS mode, COUNT(*) AS count FROM tickets " +
        "WHERE user_id = ? AND stamp IS NOT NULL AND stayed_full_block = 1 " +
        "GROUP BY activity_mode ORDER BY count DESC",
    )
    .all(userId) as unknown as CognitiveDietEntry[];
}

export function getHubStats(db: DatabaseSync, userId: number): HubStatsEntry[] {
  return db
    .prepare(
      "SELECT locations.name AS locationName, COUNT(*) AS count FROM tickets " +
        "JOIN locations ON locations.id = tickets.location_id " +
        "WHERE tickets.user_id = ? AND tickets.stamp IS NOT NULL AND tickets.stayed_full_block = 1 " +
        "GROUP BY tickets.location_id ORDER BY count DESC",
    )
    .all(userId) as unknown as HubStatsEntry[];
}

export function getUserSessionHistory(db: DatabaseSync, userId: number, limit = 20): UserHistoryEntry[] {
  const rows = db
    .prepare(
      "SELECT tickets.id AS ticketId, locations.slug AS locationSlug, locations.name AS locationName, " +
        "tickets.activity_mode AS activityMode, tickets.body AS body, tickets.stamp AS stamp, " +
        "tickets.stayed_full_block AS stayedFullBlock, tickets.cycle_start_at AS cycleStartAt " +
        "FROM tickets " +
        "JOIN locations ON locations.id = tickets.location_id " +
        "WHERE tickets.user_id = ? " +
        "ORDER BY tickets.cycle_start_at DESC, tickets.id DESC LIMIT ?",
    )
    .all(userId, limit) as unknown as (Omit<UserHistoryEntry, "stayedFullBlock"> & { stayedFullBlock: number })[];
  return rows.map((r) => ({ ...r, stayedFullBlock: !!r.stayedFullBlock }));
}

export function getLocationSessionHistory(db: DatabaseSync, locationId: number, limit = 20): LocationHistoryEntry[] {
  const rows = db
    .prepare(
      "SELECT id AS ticketId, username, activity_mode AS activityMode, body, stamp, " +
        "stayed_full_block AS stayedFullBlock, cycle_start_at AS cycleStartAt " +
        "FROM tickets WHERE location_id = ? ORDER BY cycle_start_at DESC, id DESC LIMIT ?",
    )
    .all(locationId, limit) as unknown as (Omit<LocationHistoryEntry, "stayedFullBlock"> & { stayedFullBlock: number })[];
  return rows.map((r) => ({ ...r, stayedFullBlock: !!r.stayedFullBlock }));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface LocationStats {
  vfhThisWeek: number;
  lastActiveRollovers: number;
}

// Library Stats block (RoomPage) — aggregates VFH across every mode/table at
// this location, same "stamp IS NOT NULL AND stayed_full_block = 1" predicate
// the heatmap/diet/hub-stats queries already use, which is why a "pivoted"
// stamp counts here automatically (Decision: Pivoted counts like Completed).
// lastActiveRollovers sums each mode's table-level counter since "last active
// table rolled over N times" isn't scoped to one mode in the feature request.
export function getLocationStats(db: DatabaseSync, locationId: number): LocationStats {
  const sinceEpochMs = Date.now() - WEEK_MS;
  const { count } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM tickets WHERE location_id = ? AND stamp IS NOT NULL " +
        "AND stayed_full_block = 1 AND cycle_start_at >= ?",
    )
    .get(locationId, sinceEpochMs) as { count: number };
  const { total } = db
    .prepare("SELECT COALESCE(SUM(last_active_rollovers), 0) AS total FROM room_state WHERE location_id = ?")
    .get(locationId) as { total: number };
  return { vfhThisWeek: count, lastActiveRollovers: total };
}

// --- buddies ---

export function requestBuddy(db: DatabaseSync, requesterId: number, addresseeId: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO buddies (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
  ).run(requesterId, addresseeId, Date.now());
}

// requesterId/addresseeId identify the original request; the addressee is
// who accepts it. Returns whether a pending request actually matched (so a
// route can 404 on a bogus/foreign id instead of silently succeeding).
export function acceptBuddy(db: DatabaseSync, requesterId: number, addresseeId: number): boolean {
  const result = db
    .prepare(
      "UPDATE buddies SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
    )
    .run(requesterId, addresseeId);
  return result.changes > 0;
}

export function listBuddies(db: DatabaseSync, userId: number): Buddy[] {
  return db
    .prepare(
      "SELECT id, requester_id AS requesterId, addressee_id AS addresseeId, status, created_at AS createdAt " +
        "FROM buddies WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'",
    )
    .all(userId, userId) as unknown as Buddy[];
}

// Recent VFH-qualifying tickets from this user's accepted buddies — what the
// Lobby/Profile "Buddy Feed" renders.
export function getBuddyFeed(db: DatabaseSync, userId: number, limit = 20): BuddyFeedEntry[] {
  return db
    .prepare(
      "SELECT tickets.id AS ticketId, tickets.username AS username, locations.name AS locationName, " +
        "tickets.activity_mode AS activityMode, tickets.body AS body, tickets.stamp AS stamp, " +
        "tickets.cycle_start_at AS cycleStartAt " +
        "FROM tickets " +
        "JOIN locations ON locations.id = tickets.location_id " +
        "WHERE tickets.stamp IS NOT NULL AND tickets.stayed_full_block = 1 AND tickets.user_id IN (" +
        "  SELECT addressee_id FROM buddies WHERE requester_id = ? AND status = 'accepted' " +
        "  UNION " +
        "  SELECT requester_id FROM buddies WHERE addressee_id = ? AND status = 'accepted'" +
        ") ORDER BY tickets.cycle_start_at DESC LIMIT ?",
    )
    .all(userId, userId, limit) as unknown as BuddyFeedEntry[];
}

export function findUserById(db: DatabaseSync, id: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as User | undefined;
}

export function setChimeEnabled(db: DatabaseSync, userId: number, enabled: boolean): void {
  db.prepare("UPDATE users SET chime_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
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

// Clears kudos left ON this user's tickets before the tickets themselves go,
// since kudos.ticket_id has nothing else to cascade that for.
export function deleteUserTickets(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM kudos WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)").run(userId);
  db.prepare("DELETE FROM tickets WHERE user_id = ?").run(userId);
}

export function deleteUserKudosGiven(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM kudos WHERE from_user_id = ?").run(userId);
}

export function deleteUserBuddies(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM buddies WHERE requester_id = ? OR addressee_id = ?").run(userId, userId);
}

export function deleteUserStreaks(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM streaks WHERE user_id = ?").run(userId);
}

export function deleteUserSessions(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteUserRow(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}
