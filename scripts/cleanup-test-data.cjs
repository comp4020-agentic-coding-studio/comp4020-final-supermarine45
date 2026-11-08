// One-off cleanup script (user-requested, run 2026-11-08) to strip
// accidental test/QA data out of the real data/app.db, keeping only genuine
// usage. See the conversation for the full forensic breakdown of where each
// row came from (bare `pnpm test` runs hitting :8080 by accident, the
// user-requested qa/campaign.cjs run, and ad-hoc debug probes).
//
// Keeps: users "helloworld" and "helloworld2", plus every guest ticket under
// the real usernames (Guest Platypus/Beaver/Pangolin/Echidna/Kiwi — guests
// have no row in `users`, they're identified by negative user_id + username
// on the ticket itself), and everything that legitimately references them
// (kudos, sessions, streaks, scheduled_sessions).
//
// Deletes everything else: all other users and their tickets/kudos/
// sessions/streaks, all room_goals and chat_messages (neither table has any
// row tied to a kept user — they're 100% test/debug data), and the 3 ad-hoc
// probe tickets.
//
// Run with `node scripts/cleanup-test-data.cjs` — writes to data/app.db
// directly (not read-only). A timestamped backup of the pre-cleanup file
// already exists under data/backups/.

const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync("data/app.db", { readOnly: false });

const KEEP_USERNAMES = [
  "helloworld",
  "helloworld2",
  "Guest Platypus",
  "Guest Beaver",
  "Guest Pangolin",
  "Guest Echidna",
  "Guest Kiwi",
];

db.exec("BEGIN");
try {
  const ph = KEEP_USERNAMES.map(() => "?").join(",");

  const keepUserIds = db
    .prepare(`SELECT id FROM users WHERE username IN (${ph})`)
    .all(...KEEP_USERNAMES)
    .map((r) => r.id);
  const keepTicketIds = db
    .prepare(`SELECT id FROM tickets WHERE username IN (${ph})`)
    .all(...KEEP_USERNAMES)
    .map((r) => r.id);

  const userPh = keepUserIds.map(() => "?").join(",") || "-999999999";
  const ticketPh = keepTicketIds.map(() => "?").join(",") || "-999999999";

  const results = {};

  results.kudos = db
    .prepare(`DELETE FROM kudos WHERE ticket_id NOT IN (${ticketPh})`)
    .run(...keepTicketIds).changes;

  results.tickets = db
    .prepare(`DELETE FROM tickets WHERE username NOT IN (${ph})`)
    .run(...KEEP_USERNAMES).changes;

  results.sessions = db
    .prepare(`DELETE FROM sessions WHERE user_id NOT IN (${userPh})`)
    .run(...keepUserIds).changes;

  results.streaks = db
    .prepare(`DELETE FROM streaks WHERE user_id NOT IN (${userPh})`)
    .run(...keepUserIds).changes;

  results.scheduled_sessions = db
    .prepare(`DELETE FROM scheduled_sessions WHERE user_id NOT IN (${userPh})`)
    .run(...keepUserIds).changes;

  // Neither table has any row tied to a kept user (verified beforehand) —
  // wipe both entirely rather than filter.
  results.room_goals = db.prepare(`DELETE FROM room_goals`).run().changes;
  results.chat_messages = db.prepare(`DELETE FROM chat_messages`).run().changes;

  results.users = db
    .prepare(`DELETE FROM users WHERE id NOT IN (${userPh})`)
    .run(...keepUserIds).changes;

  db.exec("COMMIT");
  console.log("Cleanup committed:", JSON.stringify(results, null, 2));

  const remaining = {
    users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    tickets: db.prepare("SELECT COUNT(*) AS n FROM tickets").get().n,
    kudos: db.prepare("SELECT COUNT(*) AS n FROM kudos").get().n,
    sessions: db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
    streaks: db.prepare("SELECT COUNT(*) AS n FROM streaks").get().n,
    scheduled_sessions: db.prepare("SELECT COUNT(*) AS n FROM scheduled_sessions").get().n,
    room_goals: db.prepare("SELECT COUNT(*) AS n FROM room_goals").get().n,
    chat_messages: db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get().n,
  };
  console.log("Remaining row counts:", JSON.stringify(remaining, null, 2));
} catch (err) {
  db.exec("ROLLBACK");
  console.error("Cleanup failed, rolled back:", err);
  process.exitCode = 1;
}
