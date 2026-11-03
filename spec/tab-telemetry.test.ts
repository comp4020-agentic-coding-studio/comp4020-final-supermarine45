import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { TAB_HIDDEN_PENALTY_MS, TABLE_CYCLE_MS } from "../src/rooms.js";

const baseUrl = inject("baseUrl");

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await fetch(new URL("/auth/register", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@anu.edu.au`, password: "password123" }),
  });
  expect(res.status, await res.text()).toBe(201);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type RosterEntry = { username: string; tabHidden: boolean };

function untilRosterEntry(
  socket: Socket,
  username: string,
  predicate: (entry: RosterEntry) => boolean,
): Promise<RosterEntry> {
  return new Promise((resolve) => {
    const handler = (payload: { roster: RosterEntry[] }): void => {
      const entry = payload.roster.find((r) => r.username === username);
      if (entry && predicate(entry)) {
        socket.off("room:update", handler);
        resolve(entry);
      }
    };
    socket.on("room:update", handler);
  });
}

function untilStatus(socket: Socket, status: string): Promise<{ timer: { status: string } }> {
  return new Promise((resolve) => {
    const handler = (payload: { timer: { status: string } }): void => {
      if (payload.timer.status === status) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// See spec/lobby-override-race.test.ts for the same reasoning: an unbounded
// wait would hang this test's own cleanup forever if the server never sent
// the event being waited for at all.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const mode = "silent";

// Live Accountability: switching away briefly flips the roster dot to amber
// for everyone watching, but returning before the 60s deadline clears it
// with no penalty — the warning is a live telemetry signal, not a strike
// that sticks around once you're back.
it(
  "clears the tab-hidden warning if tab_visible arrives before the deadline",
  async () => {
    const slug = "menzies-l2";
    const residentName = `tab-resident-${randomUUID().slice(0, 8)}`;
    const residentCookie = await registerAndGetCookie(residentName);
    const watcherCookie = await registerAndGetCookie(`tab-watcher-${randomUUID().slice(0, 8)}`);

    const resident = connect(residentCookie);
    const watcher = connect(watcherCookie);
    try {
      await Promise.all([once(resident, "connect"), once(watcher, "connect")]);

      resident.emit("room:join", { slug, mode });
      await once(resident, "room:joined");
      await once(resident, "room:update");
      watcher.emit("room:join", { slug, mode });
      await once(watcher, "room:joined");
      await once(watcher, "room:update");

      // No manual start exists anymore (Decision 2) — board a ticket and wait
      // out the real scheduler's cycle mark, same pattern as every other
      // rewritten file. Both listeners attached before the emit, same
      // reasoning as shadow-view.test.ts: broadcastRoom reaches resident and
      // watcher in the same tick.
      const residentFocus = untilStatus(resident, "focus");
      const watcherFocus = untilStatus(watcher, "focus");
      resident.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(residentFocus, TABLE_CYCLE_MS + 10000, "resident to see focus status");
      await withTimeout(watcherFocus, TABLE_CYCLE_MS + 10000, "watcher to see focus update");

      const sawAmber = untilRosterEntry(watcher, residentName, (e) => e.tabHidden === true);
      resident.emit("tab_hidden");
      await withTimeout(sawAmber, 5000, "watcher to see the resident's dot go amber");

      const sawGreenAgain = untilRosterEntry(watcher, residentName, (e) => e.tabHidden === false);
      resident.emit("tab_visible");
      await withTimeout(sawGreenAgain, 5000, "watcher to see the resident's dot clear");
    } finally {
      // No manual reset exists anymore (Decision 2) — the table's ticket for
      // this cycle simply stays until the next hourly cycle mark. Just close
      // every socket; there is nothing left to tear down server-side.
      resident.close();
      watcher.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);

// Server-Side Penalty: a tab left hidden for the full window is demoted by
// the server alone, with no client action required to "confirm" the
// penalty — the roster drops them and the socket loses write access from
// that point on, even though it never disconnected.
it(
  "demotes a user back to Shadow after the full 60s window with no tab_visible",
  async () => {
    const slug = "chifley-l2";
    const residentName = `tab-lost-${randomUUID().slice(0, 8)}`;
    const residentCookie = await registerAndGetCookie(residentName);
    const watcherCookie = await registerAndGetCookie(`tab-stay-${randomUUID().slice(0, 8)}`);

    const resident = connect(residentCookie);
    const watcher = connect(watcherCookie);
    try {
      await Promise.all([once(resident, "connect"), once(watcher, "connect")]);

      resident.emit("room:join", { slug, mode });
      await once(resident, "room:joined");
      await once(resident, "room:update");
      watcher.emit("room:join", { slug, mode });
      await once(watcher, "room:joined");
      await once(watcher, "room:update");

      const residentFocus = untilStatus(resident, "focus");
      const watcherFocus = untilStatus(watcher, "focus");
      resident.emit("room:submit-ticket", { body: "Finish problem set" });
      await withTimeout(residentFocus, TABLE_CYCLE_MS + 10000, "resident to see focus status");
      await withTimeout(watcherFocus, TABLE_CYCLE_MS + 10000, "watcher to see focus update");

      // The live warning fires immediately — proving the eventual demotion
      // below is a harsher escalation of this same signal, not an unrelated
      // mechanism.
      const sawAmber = untilRosterEntry(watcher, residentName, (e) => e.tabHidden === true);
      const residentGone = new Promise<void>((resolve) => {
        const handler = (payload: { roster: { username: string }[] }): void => {
          if (!payload.roster.some((r) => r.username === residentName)) {
            watcher.off("room:update", handler);
            resolve();
          }
        };
        watcher.on("room:update", handler);
      });

      resident.emit("tab_hidden");
      await withTimeout(sawAmber, 5000, "watcher to see the resident's dot go amber");
      // No tab_visible — really wait out the server's own timer rather than
      // faking it, matching this suite's no-fake-timers convention.
      await withTimeout(residentGone, TAB_HIDDEN_PENALTY_MS + 10000, "roster to drop the demoted user");

      // The demoted socket never disconnected, but it's lost write access —
      // proving this is a real server-side demotion, not cosmetic.
      const rejection = once<{ error: string; action: string }>(resident, "room:error");
      resident.emit("room:submit-ticket", { body: "Attempting after demotion" });
      const payload = await withTimeout(rejection, 5000, "room:error after demotion");
      expect(payload).toEqual({ error: "unauthorized", action: "room:submit-ticket" });
    } finally {
      resident.close();
      watcher.close();
    }
  },
  TABLE_CYCLE_MS + TAB_HIDDEN_PENALTY_MS + 30000,
);
