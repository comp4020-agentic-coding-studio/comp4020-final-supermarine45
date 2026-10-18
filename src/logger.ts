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
let logFilePath: string | null = null;

export function configureLogger(dbPath: string): void {
  logFilePath = join(dirname(dbPath), "activity.log");
}

export function logRoomAction(
  db: DatabaseSync,
  locationId: number | null,
  identity: string,
  action: string,
): void {
  const room = locationId !== null ? getLocationById(db, locationId)?.name ?? `location ${locationId}` : "no room";
  const line = `[${new Date().toISOString()}] [Room: ${room}] [${identity}] - ${action}`;
  console.log(line);
  if (logFilePath) appendFileSync(logFilePath, line + "\n");
}
