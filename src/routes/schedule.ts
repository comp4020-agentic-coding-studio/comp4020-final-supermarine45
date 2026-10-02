import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { Server } from "socket.io";
import { requireUser } from "../auth.js";
import { createScheduledSession, deleteScheduledSession, getLocationBySlug } from "../db.js";
import { broadcastRoom } from "../rooms.js";

// Mirrors the real ANU library's own ~2-week booking horizon — a deliberate
// nod, not a technical necessity.
const MAX_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

export function scheduleRouter(db: DatabaseSync, io: Server): Router {
  const router = Router();

  router.post("/api/locations/:slug/schedule", requireUser, (req, res) => {
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
