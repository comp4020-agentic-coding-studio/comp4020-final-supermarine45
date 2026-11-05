import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { TABLE_CYCLE_MS } from "../src/rooms.js";

const baseUrl = inject("baseUrl");

// robertson-common/writing and robertson-common/problem are the two
// (slug, mode) pairs this file claims. persistent-stats.test.ts and
// session-history.test.ts already use robertson-common with "silent" and
// "pitch" respectively — tables are keyed by (location, mode) jointly, so
// disjoint modes on the same slug can't collide. See e2e/README.md's slug
// table for the parallel convention in e2e/scenarios.
const SLUG = "robertson-common";

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

async function getMe(cookie: string): Promise<{ id: number }> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

// Deliberately sent with NO cookie at all — this is the contract this route
// exists to prove: a location's session history is a public, unauthenticated
// read, same posture as GET /api/locations/:slug/schedule.
async function getLocationHistoryNoAuth(slug: string, limit?: number): Promise<{ status: number; body: unknown }> {
  const url = new URL(`/api/locations/${slug}/history`, baseUrl);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type Ticket = { userId: number; stamp: string | null };
type RoomUpdate = { timer: { status: string }; tickets: Ticket[] };

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

function untilOwnTicketStamped(socket: Socket, userId: number): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.tickets.some((t) => t.userId === userId && t.stamp !== null)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

async function earnOneVfh(cookie: string, slug: string, mode: string, body: string): Promise<void> {
  const { id: userId } = await getMe(cookie);
  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body });
    await sawFocus;

    await untilStatus(socket, "break");

    const stamped = untilOwnTicketStamped(socket, userId);
    socket.emit("room:stamp-ticket", { stamp: "completed" });
    await stamped;
  } finally {
    socket.close();
  }
}

async function boardThenLeaveEarly(cookie: string, slug: string, mode: string, body: string, waitMs: number): Promise<void> {
  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body });
    await sawFocus;

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } finally {
    socket.close();
  }
}

it(
  "serves a completed cycle's ticket as public, unauthenticated location history",
  async () => {
    const username = `loc-hist-done-${randomUUID().slice(0, 8)}`;
    const cookie = await registerAndGetCookie(username);

    await earnOneVfh(cookie, SLUG, "writing", "Draft the intro paragraph");

    const { status, body } = await getLocationHistoryNoAuth(SLUG);
    expect(status).toBe(200);
    const { history } = body as {
      history: { username: string; activityMode: string; body: string; stamp: string | null; stayedFullBlock: boolean }[];
    };
    const entry = history.find((h) => h.username === username);
    expect(entry).toBeDefined();
    expect(entry!.activityMode).toBe("writing");
    expect(entry!.body).toBe("Draft the intro paragraph");
    expect(entry!.stamp).toBe("completed");
    expect(entry!.stayedFullBlock).toBe(true);
  },
  TABLE_CYCLE_MS + 20000,
);

it(
  "also serves a partial (left-early, unstamped) ticket in the same location's history",
  async () => {
    const username = `loc-hist-early-${randomUUID().slice(0, 8)}`;
    const cookie = await registerAndGetCookie(username);

    await boardThenLeaveEarly(cookie, SLUG, "problem", "Attempt question 3", Math.min(1500, Math.floor(TABLE_CYCLE_MS / 4)));

    const { status, body } = await getLocationHistoryNoAuth(SLUG);
    expect(status).toBe(200);
    const { history } = body as {
      history: { username: string; activityMode: string; body: string; stamp: string | null }[];
    };
    const entry = history.find((h) => h.username === username);
    expect(entry).toBeDefined();
    expect(entry!.activityMode).toBe("problem");
    expect(entry!.body).toBe("Attempt question 3");
    expect(entry!.stamp).toBe(null);
  },
  TABLE_CYCLE_MS + 20000,
);

it("honors the limit query param and caps it at 100", async () => {
  const { status, body } = await getLocationHistoryNoAuth(SLUG, 500);
  expect(status).toBe(200);
  const { history } = body as { history: unknown[] };
  expect(Array.isArray(history)).toBe(true);
  expect(history.length).toBeLessThanOrEqual(100);

  const zero = await getLocationHistoryNoAuth(SLUG, 0);
  expect((zero.body as { history: unknown[] }).history).toEqual([]);
});

it("404s on an unknown location slug", async () => {
  const { status, body } = await getLocationHistoryNoAuth("not-a-real-location-slug");
  expect(status).toBe(404);
  expect(body).toEqual({ error: "unknown location" });
});
