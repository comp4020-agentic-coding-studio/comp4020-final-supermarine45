import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { marked } from "marked";
import { countUpcomingSessions, findUserById, getLocationBySlug, isGuest, listLocations } from "../db.js";
import { readRecentLog, type LogCategory } from "../logger.js";
import { FOCUS_PRESETS_MIN } from "../rooms.js";

const LOG_CATEGORIES: readonly LogCategory[] = ["activity", "system", "status"];

export function pagesRouter(db: DatabaseSync, readmePath: string): Router {
  const router = Router();

  router.get("/api/me", (req, res) => {
    if (!req.user) {
      res.json(null);
      return;
    }
    if (isGuest(req.user.id)) {
      res.json({ id: req.user.id, username: req.user.username, focusMinutesTotal: null, isGuest: true });
      return;
    }
    const user = findUserById(db, req.user.id);
    res.json({
      id: req.user.id,
      username: req.user.username,
      focusMinutesTotal: req.user.focus_minutes_total,
      isGuest: false,
      email: user?.email,
    });
  });

  router.get("/api/locations", (_req, res) => {
    res.json(listLocations(db).map((location) => ({
      ...location,
      upcomingCount: countUpcomingSessions(db, location.id),
    })));
  });

  router.get("/api/config", (_req, res) => {
    res.json({ focusPresetsMin: FOCUS_PRESETS_MIN });
  });

  // Read-only tail of one of the three log streams (see logger.ts), exposed
  // so the test suite can assert on log *content* the same way it asserts on
  // everything else: against the running app over HTTP, never by reading its
  // disk directly. In CI the app runs inside a Docker container with an
  // ephemeral /data the test runner has no filesystem access to, so this is
  // the only way a spec can see what actually got logged. Unauthenticated,
  // same posture as every other read in this app (no login walls, no admin
  // concept) — and these logs already carry nothing more sensitive than a
  // username and a room name, same as the roster every shadow viewer sees.
  router.get("/api/logs/:category", (req, res) => {
    const category = req.params.category as LogCategory;
    if (!LOG_CATEGORIES.includes(category)) {
      res.status(404).json({ error: "unknown log category" });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json({ lines: readRecentLog(category, limit) });
  });

  router.get("/login", (_req, res) => {
    res.sendFile("login.html", { root: "public" });
  });

  router.get("/register", (_req, res) => {
    res.sendFile("register.html", { root: "public" });
  });

  router.get("/account", (_req, res) => {
    res.sendFile("account.html", { root: "public" });
  });

  router.get("/room/:slug", (req, res) => {
    const location = getLocationBySlug(db, req.params.slug);
    if (!location) {
      res.status(404).send("No such ANU location.");
      return;
    }
    res.sendFile("room.html", { root: "public" });
  });

  router.get("/readme/", (_req, res) => {
    const markdown = readFileSync(readmePath, "utf8");
    const body = marked.parse(markdown, { async: false });
    res.send(renderShell("README", body));
  });

  return router;
}

function renderShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — Shut Up and Read</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />
    <link rel="stylesheet" href="/css/style.css" />
  </head>
  <body>
    <main class="doc">
      <p><a href="/">&larr; back to the radar</a></p>
      ${bodyHtml}
    </main>
  </body>
</html>`;
}
