import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { TAB_HIDDEN_PENALTY_MS } from "../src/rooms.js";

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

// See spec/spark-and-extend.test.ts for the full rationale.
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

      resident.emit("room:join", { slug });
      await once(resident, "room:update");
      watcher.emit("room:join", { slug });
      await once(watcher, "room:update");

      // Both listeners attached before the emit — broadcastRoom reaches
      // resident and watcher in the same tick, so registering watcher's
      // listener only after awaiting resident's own promise risks missing it
      // (see shadow-view.test.ts for the same reasoning).
      const residentFocus = untilStatus(resident, "focus");
      const watcherFocus = untilStatus(watcher, "focus");
      resident.emit("room:start-focus", { minutes: 25 });
      await withTimeout(residentFocus, 10000, "resident to see focus status");
      await withTimeout(watcherFocus, 10000, "watcher to see focus update");

      const sawAmber = untilRosterEntry(watcher, residentName, (e) => e.tabHidden === true);
      resident.emit("tab_hidden");
      await withTimeout(sawAmber, 5000, "watcher to see the resident's dot go amber");

      const sawGreenAgain = untilRosterEntry(watcher, residentName, (e) => e.tabHidden === false);
      resident.emit("tab_visible");
      await withTimeout(sawGreenAgain, 5000, "watcher to see the resident's dot clear");
    } finally {
      const watcherSawIdle = untilStatus(watcher, "idle");
      resident.emit("room:reset");
      await withTimeout(watcherSawIdle, 5000, "room to confirm reset").catch(() => {});
      resident.close();
      watcher.close();
    }
  },
  20000,
);

// Server-Side Penalty: a tab left hidden for the full window is demoted by
// the server alone, with no client action required to "confirm" the
// penalty — the room narrates it, the roster drops them, and the socket
// loses write access from that point on, even though it never disconnected.
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

      resident.emit("room:join", { slug });
      await once(resident, "room:update");
      watcher.emit("room:join", { slug });
      await once(watcher, "room:update");

      // watcher (not resident) starts the block, so watcher stays
      // room:reset-eligible (resetRoom only honours the original starter)
      // even after resident is demoted and loses write access below — the
      // cleanup in `finally` must be able to end the room regardless of what
      // the test is proving about resident.
      const residentFocus = untilStatus(resident, "focus");
      const watcherFocus = untilStatus(watcher, "focus");
      watcher.emit("room:start-focus", { minutes: 25 });
      await withTimeout(residentFocus, 10000, "resident to see focus status");
      await withTimeout(watcherFocus, 10000, "watcher to see focus update");

      const notice = once<string>(watcher, "room:notice");
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
      // No tab_visible — really wait out the server's own timer rather than
      // faking it, matching this suite's no-fake-timers convention.
      const noticeText = await withTimeout(notice, TAB_HIDDEN_PENALTY_MS + 10000, "room:notice after the 60s window");
      expect(noticeText).toContain(residentName);
      await withTimeout(residentGone, 10000, "roster to drop the demoted user");

      // The demoted socket never disconnected, but it's lost write access —
      // proving this is a real server-side demotion, not cosmetic.
      const rejection = once<{ error: string; action: string }>(resident, "room:unauthorized");
      resident.emit("room:start-focus", { minutes: 25 });
      const payload = await withTimeout(rejection, 5000, "room:unauthorized after demotion");
      expect(payload.error).toBe("unauthorized");
    } finally {
      const watcherSawIdle = untilStatus(watcher, "idle");
      watcher.emit("room:reset");
      await withTimeout(watcherSawIdle, 5000, "room to confirm reset").catch(() => {});
      resident.close();
      watcher.close();
    }
  },
  TAB_HIDDEN_PENALTY_MS + 30000,
);
