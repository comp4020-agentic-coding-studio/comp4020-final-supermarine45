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

type LocationStats = { vfhThisWeek: number; lastActiveRollovers: number };

// Public, no-auth read — same posture as /api/locations/:slug/history (see
// location-history.test.ts's own getLocationHistoryNoAuth), so this
// deliberately sends no cookie to prove the route needs none.
async function getStats(slug: string): Promise<LocationStats> {
  const res = await fetch(new URL(`/api/locations/${slug}/stats`, baseUrl));
  expect(res.status).toBe(200);
  return res.json();
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type RoomUpdate = { timer: { status: string } };

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

// An unbounded wait would hang this test's own cleanup forever if the server
// never broadcast the expected state at all — same reasoning as every other
// file in this suite.
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

// Drives one user through a full focus block into break and stamps
// "completed" — the same minimal path persistent-stats.test.ts's earnOneVfh
// uses, reused here since getLocationStats's vfhThisWeek shares that exact
// "stamp IS NOT NULL AND stayed_full_block = 1" predicate.
async function earnOneVfh(cookie: string, slug: string, mode: string): Promise<void> {
  const socket = connect(cookie);
  socket.on("room:checkin-request", () => socket.emit("room:checkin-confirm"));
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body: "Read two chapters" });
    await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "focus status");

    const sawBreak = untilStatus(socket, "break");
    await withTimeout(sawBreak, TABLE_CYCLE_MS + 10000, "break status");

    socket.emit("room:stamp-ticket", { stamp: "completed" });
    // Give the stamp a moment to land before closing — closing immediately
    // after emit() can drop the packet before it flushes, same hazard
    // persistent-stats.test.ts/reconnect-sync.test.ts guard against.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    socket.close();
  }
}

it("404s for an unknown location slug", async () => {
  const res = await fetch(new URL(`/api/locations/not-a-real-${randomUUID().slice(0, 8)}/stats`, baseUrl));
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body).toEqual({ error: "unknown location" });
});

// chifley-ground never appears anywhere else in spec/ for any mode (confirmed
// by grep), so this table's VFH count starts this test file at a known
// baseline with no risk of a concurrent file's ticket inflating it.
it(
  "reflects a Verified Focus Hour earned at this location within vfhThisWeek",
  async () => {
    const slug = "chifley-ground";
    const mode = "silent";
    const cookie = await registerAndGetCookie(`stats-vfh-${randomUUID().slice(0, 8)}`);

    const before = await getStats(slug);

    await earnOneVfh(cookie, slug, mode);

    const after = await getStats(slug);
    expect(after.vfhThisWeek).toBe(before.vfhThisWeek + 1);
  },
  TABLE_CYCLE_MS + 20000,
);

// endFocus only ever increments last_active_rollovers for a table that
// actually went through a focus block with >=1 boarded ticket (beginScheduledFocus's
// own gate) — summed across every mode at this location, not scoped to one.
// hancock-ground is likewise unclaimed anywhere else in spec/, so two
// back-to-back cycles here can't be inflated by another file's table.
it(
  "increments lastActiveRollovers each time an active table's focus block resolves into break",
  async () => {
    const slug = "hancock-ground";
    const mode = "silent";
    const cookie = await registerAndGetCookie(`stats-rollover-${randomUUID().slice(0, 8)}`);

    const before = await getStats(slug);

    const socket = connect(cookie);
    socket.on("room:checkin-request", () => socket.emit("room:checkin-confirm"));
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      // Cycle 1: board, ride focus->break (this is what bumps the counter).
      const focus1 = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "First cycle ticket" });
      await withTimeout(focus1, TABLE_CYCLE_MS + 10000, "cycle 1 focus status");
      const break1 = untilStatus(socket, "break");
      await withTimeout(break1, TABLE_CYCLE_MS + 10000, "cycle 1 break status");

      const afterOne = await getStats(slug);
      expect(afterOne.lastActiveRollovers).toBe(before.lastActiveRollovers + 1);

      const idle1 = untilStatus(socket, "idle");
      await withTimeout(idle1, TABLE_CYCLE_MS + 10000, "cycle 1 to resolve back to idle");

      // Cycle 2: reboard and ride another focus->break — the counter is a
      // running lifetime total, so it should climb again, not reset.
      const focus2 = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "Second cycle ticket" });
      await withTimeout(focus2, TABLE_CYCLE_MS + 10000, "cycle 2 focus status");
      const break2 = untilStatus(socket, "break");
      await withTimeout(break2, TABLE_CYCLE_MS + 10000, "cycle 2 break status");

      const afterTwo = await getStats(slug);
      expect(afterTwo.lastActiveRollovers).toBe(before.lastActiveRollovers + 2);
    } finally {
      socket.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);
