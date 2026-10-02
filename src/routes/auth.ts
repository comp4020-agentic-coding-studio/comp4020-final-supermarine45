import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { Server } from "socket.io";
import {
  clearSessionCookie,
  createGuestIdentity,
  createSession,
  createUser,
  destroyGuestSession,
  destroySession,
  findUserByEmail,
  findUserByUsername,
  requireRealUser,
  sessionTokenFromCookieHeader,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { deleteAccount } from "../rooms.js";
import { findUserById } from "../db.js";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
// Format check only, by design: a real send-a-verification-link flow needs an
// email-sending service and API key this project hasn't provisioned. This
// just confirms the address matches ANU's domain.
const ANU_EMAIL_RE = /^[^\s@]+@anu\.edu\.au$/i;

export function authRouter(db: DatabaseSync, io: Server): Router {
  const router = Router();

  router.post("/register", (req, res) => {
    const { username, email, password } = req.body ?? {};
    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username, email and password are required" });
      return;
    }
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: "username must be 3-24 letters, digits, _ or -" });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!ANU_EMAIL_RE.test(normalizedEmail)) {
      res.status(400).json({ error: "a valid ANU email address (you@anu.edu.au) is required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    if (findUserByUsername(db, username)) {
      res.status(409).json({ error: "username is taken" });
      return;
    }
    if (findUserByEmail(db, normalizedEmail)) {
      res.status(409).json({ error: "email is already registered" });
      return;
    }
    const user = createUser(db, username, normalizedEmail, password);
    const token = createSession(db, user.id);
    setSessionCookie(res, token);
    res.status(201).json({ username: user.username });
  });

  router.post("/login", (req, res) => {
    const { username, password } = req.body ?? {};
    const user = typeof username === "string" ? findUserByUsername(db, username) : undefined;
    if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash, user.salt)) {
      res.status(401).json({ error: "wrong username or password" });
      return;
    }
    const token = createSession(db, user.id);
    setSessionCookie(res, token);
    res.json({ username: user.username });
  });

  router.post("/guest", (req, res) => {
    const { token, identity } = createGuestIdentity();
    setSessionCookie(res, token);
    res.status(201).json({ username: identity.username });
  });

  router.post("/logout", (req, res) => {
    const token = sessionTokenFromCookieHeader(req.headers.cookie);
    if (token) {
      destroySession(db, token);
      destroyGuestSession(token);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Re-confirms the password rather than trusting the session alone, because
  // this is irreversible and the session cookie could've been left signed in
  // on a shared machine.
  router.delete("/account", requireRealUser, (req, res) => {
    const { password } = req.body ?? {};
    const user = findUserById(db, req.user!.id);
    if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash, user.salt)) {
      res.status(401).json({ error: "wrong password" });
      return;
    }
    deleteAccount(io, db, user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
