import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import {
  clearSessionCookie,
  createSession,
  createUser,
  destroySession,
  findUserByEmail,
  findUserByUsername,
  sessionTokenFromCookieHeader,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
// Format check only, by design: a real send-a-verification-link flow needs an
// email-sending service and API key this project hasn't provisioned. This
// just confirms the address matches ANU's domain.
const ANU_EMAIL_RE = /^[^\s@]+@anu\.edu\.au$/i;

export function authRouter(db: DatabaseSync): Router {
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

  router.post("/logout", (req, res) => {
    const token = sessionTokenFromCookieHeader(req.headers.cookie);
    if (token) destroySession(db, token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
