import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Identity } from "./db.js";
import { getLocationById } from "./db.js";

export function identityLabel(user: Identity | undefined, socketId: string): string {
  return user ? `'${user.username}'` : `Session ${socketId}`;
}

// Logs need to survive a server restart or redeploy, not just show up in
// whatever terminal happens to be watching stdout at the time — so this
// mirrors every line onto disk next to the DB file, which on Fly is the one
// path (the mounted volume) that actually persists across those.
//
// Split into two files: system.log for connection lifecycle (who is
// physically present in a room, independent of what they do there) and
// activity.log for everything a user actually *did* with a feature (voting,
// tab-penalty, rejected attempts, chat, goals, pseudonym choice, ...). This
// keeps "who's in the room right now" auditable on its own, separate from
// the much noisier stream of feature-level events.
let activityLogPath: string | null = null;
let systemLogPath: string | null = null;

export function configureLogger(dbPath: string): void {
  activityLogPath = join(dirname(dbPath), "activity.log");
  systemLogPath = join(dirname(dbPath), "system.log");
}

function writeLog(
  filePath: string | null,
  tag: "System" | "Activity",
  db: DatabaseSync,
  locationId: number | null,
  identity: string,
  action: string,
): void {
  const room = locationId !== null ? getLocationById(db, locationId)?.name ?? `location ${locationId}` : "no room";
  const line = `[${new Date().toISOString()}] [${tag}] [Room: ${room}] [${identity}] - ${action}`;
  console.log(line);
  if (filePath) appendFileSync(filePath, line + "\n");
}

// Activity logging: feature-level events (voting, tab penalties, rejected
// actions, chat, goals, pseudonym choice, ...) — what a user *did*.
export function logRoomAction(db: DatabaseSync, locationId: number | null, identity: string, action: string): void {
  writeLog(activityLogPath, "Activity", db, locationId, identity, action);
}

// System logging: connection lifecycle only — a user joining or leaving a
// room, independent of anything they do once there.
export function logSystemAction(db: DatabaseSync, locationId: number | null, identity: string, action: string): void {
  writeLog(systemLogPath, "System", db, locationId, identity, action);
}
