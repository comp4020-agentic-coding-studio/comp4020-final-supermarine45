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

const mode = "silent";

// The bug: a user who stays connected through an entire focus block (never
// demoted, so stayed_full_block stays 1) but then closes their app/tab during
// break — before ever clicking a Break Modal stamp button — has no remaining
// way to check out, and historically just lost the VFH forever with no
// indication why. Disconnecting during break is the one point this user
// becomes structurally unable to ever stamp, which is why leaveTable now
// auto-stamps a still-eligible, still-unstamped ticket as "completed" right
// at that moment (see src/rooms.ts's autoStampAbandonedTicket).
it(
  "auto-credits VFH when a full-block ticket holder disconnects during break without stamping",
  async () => {
    const slug = "chifley";
    const username = `vanish-${randomUUID().slice(0, 8)}`;
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

      // Disconnects immediately on reaching break, before ever emitting
      // room:stamp-ticket — the exact gap this fix targets.
      socket.close();
    } finally {
      // no-op: already closed above, kept for parity with the shared idiom.
    }

    // Give the server a moment to process the disconnect event and run the
    // auto-stamp before reading back VFH through a fresh login.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const returnCookie = await loginAndGetCookie(username, password);
    const me = await getMe(returnCookie);
    expect(me.vfhCount).toBe(1);
  },
  TABLE_CYCLE_MS * 2 + 20000,
);

// A second open connection for the same user must NOT get auto-stamped out
// from under them just because one of their tabs closed — only losing the
// LAST live connection to the table should trigger the auto-stamp.
it(
  "does not auto-stamp when the user still has another live connection to the table",
  async () => {
    // hancock is already claimed on "silent" by personal-duration-checkin.test.ts;
    // "pitch" is free there, giving a disjoint (slug, mode) pair.
    const slug = "hancock";
    const dualMode = "pitch";
    const username = `multi-tab-${randomUUID().slice(0, 8)}`;
    const password = "password123";
    const cookie = await registerAndGetCookie(username);

    const first = connect(cookie);
    const second = connect(cookie);
    first.on("room:checkin-request", () => first.emit("room:checkin-confirm"));
    second.on("room:checkin-request", () => second.emit("room:checkin-confirm"));
    try {
      await Promise.all([once(first, "connect"), once(second, "connect")]);
      first.emit("room:join", { slug, mode: dualMode });
      await once(first, "room:joined");
      await once(first, "room:update");
      second.emit("room:join", { slug, mode: dualMode });
      await once(second, "room:joined");
      await once(second, "room:update");

      const sawFocus = untilStatus(first, "focus");
      first.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "ticket to see focus status");

      await withTimeout(untilStatus(first, "break"), TABLE_CYCLE_MS + 10000, "table to reach break");

      // Only the first tab disconnects; the second tab for the same user is
      // still live, so the ticket must stay un-stamped (eligible to be
      // stamped manually from the second tab, not auto-credited yet).
      first.close();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const stillUnstamped = await getMe(cookie);
      expect(stillUnstamped.vfhCount).toBe(0);
    } finally {
      second.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);
