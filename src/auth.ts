import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Request, Response, NextFunction } from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import type { User } from "./db.js";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
      user?: User;
    }
  }
}

export function attachUser(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = sessionTokenFromCookieHeader(req.headers.cookie);
    req.user = token ? userForToken(db, token) : undefined;
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

export function userFromSocketCookie(
  db: DatabaseSync,
  cookieHeader: string | undefined,
): User | undefined {
  const token = sessionTokenFromCookieHeader(cookieHeader);
  return token ? userForToken(db, token) : undefined;
}
