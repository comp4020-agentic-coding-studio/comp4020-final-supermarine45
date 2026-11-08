import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { CHECKIN_GRACE_MS, TABLE_CYCLE_MS } from "../src/rooms.js";

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

type RosterEntry = { username: string; checkinPending: boolean };

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

type CheckinRequest = { deadlineAt: number };

// Programmatic Honesty (micro check-ins): tab visibility is no longer the
// activity signal (students legitimately tab away to code, use Google Docs,
// etc. — see prompt-to-do.md) — the server pings every live Active user
// directly (CHECKIN_OFFSETS_MIN into the focus block) and requires an
// explicit click-to-confirm within CHECKIN_GRACE_MS. Confirming in time
// clears the roster's amber dot with no penalty, same as the old tab-hidden
// warning used to, and the table stays in focus throughout.
it(
  "clears the check-in warning if the user confirms before the deadline",
  async () => {
    const slug = "menzies-l2";
    const residentName = `ckin-resident-${randomUUID().slice(0, 8)}`;
    const residentCookie = await registerAndGetCookie(residentName);
    const watcherCookie = await registerAndGetCookie(`ckin-watcher-${randomUUID().slice(0, 8)}`);

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

      // Wait for the real, server-scheduled first ping (armCheckinTimers) —
      // not a client-triggered fake — so this proves the actual 20-minute
      // (test-speed-scaled) offset fires and targets just this socket.
      const sawPending = untilRosterEntry(watcher, residentName, (e) => e.checkinPending === true);
      const checkinRequested = once<CheckinRequest>(resident, "room:checkin-request");
      await withTimeout(checkinRequested, TABLE_CYCLE_MS + 10000, "resident to receive the first check-in ping");
      await withTimeout(sawPending, 5000, "watcher to see the resident's dot go amber");

      const sawClear = untilRosterEntry(watcher, residentName, (e) => e.checkinPending === false);
      resident.emit("room:checkin-confirm");
      await withTimeout(sawClear, 5000, "watcher to see the resident's dot clear");

      // Confirming must not demote: the table stays in focus and the
      // resident can still act on it. Kudos is now allowed during focus too
      // (item 3), so a bogus recipient id clears the phase gate and fails on
      // recipient lookup instead — not_found, not not_breaking — which is
      // itself proof the resident is still authorized and active post-confirm.
      const sawKudosRejection = once<{ error: string; action: string }>(resident, "room:error");
      resident.emit("room:send-kudos", { toUserId: -1, emoji: "⚡" });
      const payload = await withTimeout(sawKudosRejection, 5000, "room:error for kudos to an unknown recipient");
      expect(payload).toEqual({ error: "not_found", action: "room:send-kudos" });
    } finally {
      resident.close();
      watcher.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);

it(
  "demotes a user back to Shadow after the full check-in grace window with no confirmation",
  async () => {
    const slug = "chifley-l2";
    const residentName = `checkin-lost-${randomUUID().slice(0, 8)}`;
    const residentCookie = await registerAndGetCookie(residentName);
    const watcherCookie = await registerAndGetCookie(`checkin-stay-${randomUUID().slice(0, 8)}`);

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

      const residentGone = new Promise<void>((resolve) => {
        const handler = (payload: { roster: { username: string }[] }): void => {
          if (!payload.roster.some((r) => r.username === residentName)) {
            watcher.off("room:update", handler);
            resolve();
          }
        };
        watcher.on("room:update", handler);
      });

      // No tab_hidden event exists anymore (Decision: micro check-ins replace
      // tab-visibility tracking) — never confirming leaves the grace timeout
      // to fire on its own, same as the old "no tab_visible" path.
      await withTimeout(residentGone, CHECKIN_GRACE_MS + TABLE_CYCLE_MS + 10000, "roster to drop the demoted user");

      // The demoted socket never disconnected, but it's lost write access —
      // proving this is a real server-side demotion, not cosmetic. Distinct
      // "demoted" error code (not the generic "unauthorized" a Shadow socket
      // gets) so the client can show copy that actually explains what
      // happened, instead of a confusing "you need a name" message to
      // someone who already has one.
      const rejection = once<{ error: string; action: string }>(resident, "room:error");
      resident.emit("room:submit-ticket", { body: "Attempting after demotion" });
      const payload = await withTimeout(rejection, 5000, "room:error after demotion");
      expect(payload).toEqual({ error: "demoted", action: "room:submit-ticket" });
    } finally {
      resident.close();
      watcher.close();
    }
  },
  TABLE_CYCLE_MS + CHECKIN_GRACE_MS + 30000,
);
