import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { TABLE_CYCLE_MS } from "../src/rooms.js";

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

async function loginAndGetCookie(username: string, password: string): Promise<string> {
  const res = await fetch(new URL("/auth/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status, await res.text()).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

async function getMe(cookie: string): Promise<{ id: number; vfhCount: number | null }> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type RoomUpdate = { timer: { status: string }; tickets: { userId: number; stamp: string | null }[] };

function untilStatus(socket: Socket, status: string): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.timer.status === status) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

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

// Item 7 of the combined feature/bug request: "leaving the room after the
// session ends still counts as leaving early." Two distinct gaps in
// autoStampAbandonedTicket (src/rooms.ts) produced this:
//   (A) a personal-duration ticket holder whose own shorter block has already
//       elapsed disconnects while the table is still "focus" for everyone
//       else — the old code only ever looked at "break", so this got nothing.
//   (B) a user who sits through all of break without stamping, then
//       disconnects only after the table has rolled over to "idle" — by then
//       endBreak has nulled state.phaseStartedAt, so the old code (and even a
//       naive "focus or break" check) has no cycle key left to find the
//       ticket with at all.
// Both are fixed by branching on state.status (focus/break/idle) and, for
// idle, using the new getMostRecentStartedTicket (src/db.ts) to find the
// ticket by scanning backward from "now" instead of a cycle key.

it(
  "auto-credits VFH when a personal-duration ticket holder disconnects after their own block ends but before the table's focus block ends",
  async () => {
    // chifley-l1 is already claimed by early-finish-stamp.test.ts ("silent")
    // and concurrent-tickets.test.ts ("writing") — "pitch" here is a
    // disjoint, collision-free pairing on the same slug. Deliberately not
    // chifley-ground/hancock-ground: location-stats.test.ts asserts an exact
    // vfhThisWeek/lastActiveRollovers delta there, which getLocationStats
    // sums across every mode at the location — any VFH earned here on those
    // two slugs, in any mode, would inflate that count underneath it.
    const slug = "chifley-l1";
    const mode = "pitch";
    const username = `early-vanish-${randomUUID().slice(0, 8)}`;
    const password = "password123";
    const cookie = await registerAndGetCookie(username);

    const socket = connect(cookie);
    socket.on("room:checkin-request", () => socket.emit("room:checkin-confirm"));
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "quarter-block read", personalDurationMinutes: 25 });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "ticket to see focus status");
      const focusStartedAt = Date.now();

      // A 25-minute preset is half of FOCUS_DURATION_MS — wait past that
      // point (plus slack) while the table itself is still well short of its
      // own full focus block, then disconnect without ever stamping.
      const personalDurationMs = (TABLE_CYCLE_MS * (50 / 60)) / 2;
      const elapsed = Date.now() - focusStartedAt;
      const remaining = personalDurationMs - elapsed + 2000;
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

      socket.close();
    } finally {
      // no-op: already closed above, kept for parity with the shared idiom.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    const returnCookie = await loginAndGetCookie(username, password);
    const me = await getMe(returnCookie);
    expect(me.vfhCount).toBe(1);
  },
  TABLE_CYCLE_MS + 30000,
);

it(
  "auto-credits VFH when a ticket holder stays connected through all of break without stamping, then disconnects after the table goes idle",
  async () => {
    // hancock-l2 is already claimed by stuck-flag.test.ts on "silent" — this
    // test needs a stamp-eligible mode anyway (stuck-flag's own wrong_mode
    // check requires non-"problem"), so "problem" here is both disjoint and
    // deliberately avoids chifley-ground/hancock-ground (see the sibling
    // test above for why those two slugs are off-limits for VFH-earning).
    const slug = "hancock-l2";
    const mode = "problem";
    const username = `idle-vanish-${randomUUID().slice(0, 8)}`;
    const password = "password123";
    const cookie = await registerAndGetCookie(username);

    const socket = connect(cookie);
    socket.on("room:checkin-request", () => socket.emit("room:checkin-confirm"));
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "ticket to see focus status");

      await withTimeout(untilStatus(socket, "break"), TABLE_CYCLE_MS + 10000, "table to reach break");

      // Ride out the whole break without ever emitting room:stamp-ticket,
      // until the table rolls over to idle — the exact gap this fix targets.
      await withTimeout(untilStatus(socket, "idle"), TABLE_CYCLE_MS + 10000, "table to go idle after break");

      socket.close();
    } finally {
      // no-op: already closed above, kept for parity with the shared idiom.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    const returnCookie = await loginAndGetCookie(username, password);
    const me = await getMe(returnCookie);
    expect(me.vfhCount).toBe(1);
  },
  TABLE_CYCLE_MS * 2 + 20000,
);
