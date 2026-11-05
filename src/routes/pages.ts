import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { marked } from "marked";
import {
  acceptBuddy,
  countUpcomingSessions,
  findUserById,
  getBuddyFeed,
  getCognitiveDiet,
  getHeatmap,
  getHubStats,
  getUserSessionHistory,
  getVfhCount,
  isGuest,
  listBuddies,
  listLocations,
  listStreaksForUser,
  requestBuddy,
} from "../db.js";
import { requireRealUser } from "../auth.js";
import { parseLimit } from "../http.js";
import { readRecentLog, type LogCategory } from "../logger.js";
import { ACTIVITY_MODE_INFO } from "../rooms.js";

const LOG_CATEGORIES: readonly LogCategory[] = ["activity", "system", "status"];

export function pagesRouter(db: DatabaseSync, readmePath: string): Router {
  const router = Router();

  router.get("/api/me", (req, res) => {
    if (!req.user) {
      res.json(null);
      return;
    }
    if (isGuest(req.user.id)) {
      res.json({ id: req.user.id, username: req.user.username, vfhCount: null, isGuest: true });
      return;
    }
    const user = findUserById(db, req.user.id);
    res.json({
      id: req.user.id,
      username: req.user.username,
      vfhCount: getVfhCount(db, req.user.id),
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
    res.json({ activityModes: ACTIVITY_MODE_INFO });
  });

  // Strava-style profile reads, registered users only — mirrors the
  // requireRealUser posture of other persistent-future/persistent-identity
  // routes (e.g. schedule.ts's booking endpoints): meaningless for a guest
  // identity that leaves no users row behind.
  router.get("/api/me/heatmap", requireRealUser, (req, res) => {
    const sinceDays = Math.min(Number(req.query.days) || 365, 365);
    const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    res.json({ days: getHeatmap(db, req.user!.id, since) });
  });

  router.get("/api/me/diet", requireRealUser, (req, res) => {
    res.json({ modes: getCognitiveDiet(db, req.user!.id) });
  });

  router.get("/api/me/hub-stats", requireRealUser, (req, res) => {
    res.json({ hubs: getHubStats(db, req.user!.id) });
  });

  router.get("/api/me/streaks", requireRealUser, (req, res) => {
    res.json({ streaks: listStreaksForUser(db, req.user!.id) });
  });

  router.get("/api/me/history", requireRealUser, (req, res) => {
    const limit = parseLimit(req.query.limit, 20, 100);
    res.json({ history: getUserSessionHistory(db, req.user!.id, limit) });
  });

  router.get("/api/me/buddies", requireRealUser, (req, res) => {
    res.json({ buddies: listBuddies(db, req.user!.id) });
  });

  router.get("/api/me/buddy-feed", requireRealUser, (req, res) => {
    const limit = parseLimit(req.query.limit, 20, 100);
    res.json({ feed: getBuddyFeed(db, req.user!.id, limit) });
  });

  router.post("/api/buddies/request", requireRealUser, (req, res) => {
    const addresseeId = Number(req.body?.addresseeId);
    if (!Number.isFinite(addresseeId)) {
      res.status(400).json({ error: "addresseeId is required" });
      return;
    }
    if (addresseeId === req.user!.id) {
      res.status(400).json({ error: "cannot buddy yourself" });
      return;
    }
    requestBuddy(db, req.user!.id, addresseeId);
    res.status(201).json({ ok: true });
  });

  router.post("/api/buddies/:id/accept", requireRealUser, (req, res) => {
    const requesterId = Number(req.params.id);
    if (!Number.isFinite(requesterId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const accepted = acceptBuddy(db, requesterId, req.user!.id);
    if (!accepted) {
      res.status(404).json({ error: "no pending request from that user" });
      return;
    }
    res.status(200).json({ ok: true });
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
    const limit = parseLimit(req.query.limit, 200, 1000);
    res.json({ lines: readRecentLog(category, limit) });
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
