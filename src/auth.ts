import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Request, Response, NextFunction } from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import { isGuest, type Identity, type User } from "./db.js";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Guest identities get zero DB footprint — no users row, no sessions row —
// because "won't persist beyond this session" is easiest to guarantee
// honestly by never writing it down, rather than writing it and remembering
// to delete it later. They live only in this in-memory map for the life of
// the process, keyed by the same opaque token a real session would use.
interface GuestRecord {
  identity: Identity;
  lastSeen: number;
}

const guestSessions = new Map<string, GuestRecord>();
// Decrementing counter so guest ids can never collide with a real user's
// AUTOINCREMENT id (always >= 1) — isGuest(id) is just id < 0.
let nextGuestId = -1;

const GUEST_ADJECTIVES = [
  "Sleepy", "Quiet", "Curious", "Swift", "Gentle", "Bold", "Quiet", "Clever",
  "Calm", "Restless", "Patient", "Wandering", "Drowsy", "Steady", "Nimble",
  "Stubborn", "Cheerful", "Watchful", "Humble", "Brisk",
] as const;

const GUEST_ANIMALS = [
  "Koala", "Otter", "Fox", "Owl", "Badger", "Heron", "Wombat", "Possum",
  "Magpie", "Quokka", "Platypus", "Kookaburra", "Dingo", "Echidna", "Ibis",
  "Cockatoo", "Wallaby", "Kiwi", "Penguin", "Hedgehog", "Raccoon", "Beaver",
  "Lynx", "Falcon", "Heron", "Tapir", "Marmot", "Pangolin", "Capybara", "Mole",
] as const;

function randomGuestName(): string {
  const adjective = GUEST_ADJECTIVES[Math.floor(Math.random() * GUEST_ADJECTIVES.length)];
  const animal = GUEST_ANIMALS[Math.floor(Math.random() * GUEST_ANIMALS.length)];
  const suffix = Math.floor(Math.random() * 90 + 10); // 10-99, for same-room distinctness
  return `${adjective} ${animal} ${suffix}`;
}

// Creates a brand-new, never-before-seen guest identity and registers it in
// the in-memory map. The caller still needs to setSessionCookie(res, token).
export function createGuestIdentity(): { token: string; identity: Identity } {
  const token = randomBytes(32).toString("hex");
  const identity: Identity = { id: nextGuestId--, username: randomGuestName(), focus_minutes_total: 0 };
  guestSessions.set(token, { identity, lastSeen: Date.now() });
  return { token, identity };
}

function guestForToken(token: string): Identity | undefined {
  const record = guestSessions.get(token);
  if (!record) return undefined;
  record.lastSeen = Date.now();
  return record.identity;
}

export function destroyGuestSession(token: string): void {
  guestSessions.delete(token);
}

// Bounds memory growth from abandoned guest tabs — nothing else ever cleans
// these up, since there's no DB row and no expiry column to check.
const GUEST_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const GUEST_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - GUEST_MAX_IDLE_MS;
  for (const [token, record] of guestSessions) {
    if (record.lastSeen < cutoff) guestSessions.delete(token);
  }
}, GUEST_SWEEP_INTERVAL_MS).unref();

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createUser(db: DatabaseSync, username: string, email: string, password: string): User {
  const { hash, salt } = hashPassword(password);
  const result = db
    .prepare(
      "INSERT INTO users (username, email, password_hash, salt, created_at, focus_minutes_total) " +
        "VALUES (?, ?, ?, ?, ?, 0)",
    )
    .run(username, email, hash, salt, Date.now());
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as unknown as User;
}

export function findUserByUsername(db: DatabaseSync, username: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as
    | User
    | undefined;
}

export function findUserByEmail(db: DatabaseSync, email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as User | undefined;
}

export function createSession(db: DatabaseSync, userId: number): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function userForToken(db: DatabaseSync, token: string): User | undefined {
  return db
    .prepare(
      "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id " +
        "WHERE sessions.token = ? AND sessions.expires_at > ?",
    )
    .get(token, Date.now()) as unknown as User | undefined;
}

// Guest sessions are checked first (a cheap in-memory lookup) before falling
// back to the real DB-backed session table, so one cookie mechanism serves
// both identity kinds.
function identityForToken(db: DatabaseSync, token: string): Identity | undefined {
  return guestForToken(token) ?? userForToken(db, token);
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    }),
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: SESSION_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
}

export function sessionTokenFromCookieHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  return parseCookie(header)[SESSION_COOKIE];
}

declare global {
  namespace Express {
    interface Request {
      user?: Identity;
    }
  }
}

export function attachUser(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = sessionTokenFromCookieHeader(req.headers.cookie);
    req.user = token ? identityForToken(db, token) : undefined;
    next();
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "sign in required" });
    return;
  }
  next();
}

// Like requireUser, but rejects guests too — for anything that's a persistent
// future commitment (planning ahead, deleting an account), which can't mean
// anything for an identity guaranteed to be gone by the time it matters.
export function requireRealUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "sign in required" });
    return;
  }
  if (isGuest(req.user.id)) {
    res.status(403).json({ error: "sign up for a real account to do that" });
    return;
  }
  next();
}

export function userFromSocketCookie(
  db: DatabaseSync,
  cookieHeader: string | undefined,
): Identity | undefined {
  const token = sessionTokenFromCookieHeader(cookieHeader);
  return token ? identityForToken(db, token) : undefined;
}
