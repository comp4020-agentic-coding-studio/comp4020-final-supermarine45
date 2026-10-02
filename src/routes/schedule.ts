import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { Server } from "socket.io";
import { requireRealUser, requireUser } from "../auth.js";
import {
  createScheduledSession,
  deleteScheduledSession,
  getLocationBySlug,
  listUpcomingSessions,
  listUpcomingSessionsForUser,
} from "../db.js";
import { broadcastRoom } from "../rooms.js";

// Mirrors the real ANU library's own ~2-week booking horizon — a deliberate
// nod, not a technical necessity.
const MAX_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

export function scheduleRouter(db: DatabaseSync, io: Server): Router {
  const router = Router();

  // Plain read, same visibility as the room page itself — lets the client
  // render the current list immediately on page load instead of waiting on
  // the first room:update socket round-trip.
  router.get("/api/locations/:slug/schedule", (req, res) => {
    const location = getLocationBySlug(db, req.params.slug as string);
    if (!location) {
      res.status(404).json({ error: "unknown location" });
      return;
    }
    res.json({ sessions: listUpcomingSessions(db, location.id) });
  });

  // The one place that answers "what have I actually booked", across every
  // location, not just whichever room you booked it from. Guests are turned
  // away by requireUser only in the sense that they have no bookings to show;
  // requireUser (not requireRealUser) is enough here since this is a read.
  router.get("/api/me/schedule", requireUser, (req, res) => {
    res.json({ sessions: listUpcomingSessionsForUser(db, req.user!.id) });
  });

  // requireRealUser, not requireUser: a scheduled session is a persistent
  // future commitment, which can't mean anything for a guest identity
  // guaranteed to be gone by the time that future arrives.
  router.post("/api/locations/:slug/schedule", requireRealUser, (req, res) => {
    const location = getLocationBySlug(db, req.params.slug as string);
    if (!location) {
      res.status(404).json({ error: "unknown location" });
      return;
    }
    const { startsAt } = req.body ?? {};
    if (typeof startsAt !== "number" || !Number.isFinite(startsAt)) {
      res.status(400).json({ error: "startsAt (epoch ms) is required" });
      return;
    }
    const now = Date.now();
    if (startsAt <= now) {
      res.status(400).json({ error: "startsAt must be in the future" });
      return;
    }
    if (startsAt > now + MAX_HORIZON_MS) {
      res.status(400).json({ error: "sessions can only be planned up to 14 days ahead" });
      return;
    }
    createScheduledSession(db, location.id, req.user!.id, startsAt);
    broadcastRoom(io, db, location.id);
    res.status(201).json({ ok: true });
  });

  router.delete("/api/schedule/:id", requireUser, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const locationId = deleteScheduledSession(db, id, req.user!.id);
    if (locationId === undefined) {
      res.status(404).json({ error: "not found" });
      return;
    }
    broadcastRoom(io, db, locationId);
    res.status(200).json({ ok: true });
  });

  return router;
}
