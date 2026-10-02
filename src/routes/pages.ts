import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { marked } from "marked";
import { getLocationBySlug, listLocations } from "../db.js";
import { FOCUS_PRESETS_MIN } from "../rooms.js";

export function pagesRouter(db: DatabaseSync, readmePath: string): Router {
  const router = Router();

  router.get("/api/me", (req, res) => {
    res.json(req.user ? { username: req.user.username, focusMinutesTotal: req.user.focus_minutes_total } : null);
  });

  router.get("/api/locations", (_req, res) => {
    res.json(listLocations(db));
  });

  router.get("/api/config", (_req, res) => {
    res.json({ focusPresetsMin: FOCUS_PRESETS_MIN });
  });

  router.get("/login", (_req, res) => {
    res.sendFile("login.html", { root: "public" });
  });

  router.get("/register", (_req, res) => {
    res.sendFile("register.html", { root: "public" });
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
