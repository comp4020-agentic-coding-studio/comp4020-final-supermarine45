import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { TABLE_CYCLE_MS } from "../src/rooms.js";

const baseUrl = inject("baseUrl");

// robertson-common/pitch and chifley-lg/writing are the two (slug, mode)
// pairs this file claims — see e2e/README.md's slug table and
// persistent-stats.test.ts, which only ever uses these two slugs with
// "silent", so there is no collision.
const SLUG = "robertson-common";
const MODE = "pitch";

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

async function getMe(cookie: string): Promise<{ id: number; username: string }> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

async function getHistory(cookie: string, limit?: number): Promise<{ history: unknown[] }> {
  const url = new URL("/api/me/history", baseUrl);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
  const res = await fetch(url, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

async function getStreaks(cookie: string): Promise<{ streaks: unknown[] }> {
  const res = await fetch(new URL("/api/me/streaks", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
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

// Same shape as persistent-stats.test.ts's earnOneVfh — board, ride the
// scheduler's own focus->break transition, stamp.
async function earnOneVfh(cookie: string, slug: string, mode: string, stamp: "completed" | "partial"): Promise<void> {
  const { id: userId } = await getMe(cookie);
  const socket = connect(cookie);
  // Stays connected through a full focus block into break, long enough for
  // the server's own check-in pings to reach it (see tab-telemetry.test.ts)
  // — answering honestly keeps this helper's VFH stamp from being silently
  // rejected by the unrelated check-in demotion path.
  socket.on("room:checkin-request", () => socket.emit("room:checkin-confirm"));
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body: "Read two chapters" });
    await sawFocus;

    await untilStatus(socket, "break");

    const stamped = untilOwnTicketStamped(socket, userId);
    socket.emit("room:stamp-ticket", { stamp });
    await stamped;
  } finally {
    socket.close();
  }
}

// Boards a ticket and disconnects well before break — nothing is ever
// stamped, but the ticket row (and therefore the history entry) still exists.
async function boardThenLeaveEarly(cookie: string, slug: string, mode: string, waitMs: number): Promise<void> {
  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body: "Skim one article" });
    await sawFocus;

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } finally {
    socket.close();
  }
}

it(
  "records a completed cycle as a history entry with the stamp and full-block flag set",
  async () => {
    const username = `hist-done-${randomUUID().slice(0, 8)}`;
    const cookie = await registerAndGetCookie(username);

    await earnOneVfh(cookie, SLUG, MODE, "completed");

    const { history } = await getHistory(cookie);
    expect(history.length).toBe(1);
    const entry = history[0] as {
      locationSlug: string;
      activityMode: string;
      body: string;
      stamp: string | null;
      stayedFullBlock: boolean;
    };
    expect(entry.locationSlug).toBe(SLUG);
    expect(entry.activityMode).toBe(MODE);
    expect(entry.body).toBe("Read two chapters");
    expect(entry.stamp).toBe("completed");
    expect(entry.stayedFullBlock).toBe(true);
  },
  TABLE_CYCLE_MS + 20000,
);

// The key regression this file exists to cover: the heatmap/VFH queries all
// filter on "stamp IS NOT NULL AND stayed_full_block = 1" (see getVfhCount),
// but history is meant to show what actually happened, early leaves
// included. A ticket whose holder disconnected before break is never
// stamped (stamping only happens during the break phase), so it must still
// show up in history with stamp: null — proving this query has no such
// filter — even though stayedFullBlock stays at its default `true`, since
// only the separate tab-hidden-penalty path (markTicketNotFullBlock) ever
// flips that column, and this scenario never triggers it.
it(
  "still records a ticket as history when its holder left before the block ended",
  async () => {
    const username = `history-leaver-${randomUUID().slice(0, 8)}`;
    const cookie = await registerAndGetCookie(username);

    await boardThenLeaveEarly(cookie, "chifley-lg", "writing", Math.min(1500, Math.floor(TABLE_CYCLE_MS / 4)));

    const { history } = await getHistory(cookie);
    expect(history.length).toBe(1);
    const entry = history[0] as {
      locationSlug: string;
      activityMode: string;
      body: string;
      stamp: string | null;
      stayedFullBlock: boolean;
    };
    expect(entry.locationSlug).toBe("chifley-lg");
    expect(entry.activityMode).toBe("writing");
    expect(entry.body).toBe("Skim one article");
    expect(entry.stamp).toBe(null);
    expect(entry.stayedFullBlock).toBe(true);
  },
  TABLE_CYCLE_MS + 20000,
);

it("honors the limit query param and caps it at 100", async () => {
  const username = `history-limit-${randomUUID().slice(0, 8)}`;
  const cookie = await registerAndGetCookie(username);

  const { history: capped } = await getHistory(cookie, 500);
  expect(Array.isArray(capped)).toBe(true);
  expect(capped.length).toBeLessThanOrEqual(100);

  const { history: zero } = await getHistory(cookie, 0);
  expect(zero).toEqual([]);
});

it("returns an empty streaks list for a fresh user", async () => {
  const username = `streaks-fresh-${randomUUID().slice(0, 8)}`;
  const cookie = await registerAndGetCookie(username);

  const { streaks } = await getStreaks(cookie);
  expect(streaks).toEqual([]);
});
