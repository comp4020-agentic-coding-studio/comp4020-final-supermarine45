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

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
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

// Personal Shorter Duration (see PERSONAL_DURATION_PRESETS_MIN) must scale
// the micro check-in pings too, not just the user's own progress ring: a
// user who boards a 25-minute personal block is gone well before the full
// block's fixed 20/35-minute marks would ever fire for them, so
// armCheckinTimers has to look up each presence's own current ticket at fire
// time and ping it at proportionally the same two points in *its own* block.
// This proves a 25-minute-block boarder gets pinged meaningfully before a
// same-table 50-minute-block boarder does, at the real server-scheduled
// offset (not a client-triggered fake).
it(
  "pings a shorter personal-duration ticket earlier than a full-block ticket at the same table",
  async () => {
    const slug = "hancock";
    const shortName = `pd-short-${randomUUID().slice(0, 8)}`;
    const fullName = `pd-full-${randomUUID().slice(0, 8)}`;
    const shortCookie = await registerAndGetCookie(shortName);
    const fullCookie = await registerAndGetCookie(fullName);

    const shortSocket = connect(shortCookie);
    const fullSocket = connect(fullCookie);
    try {
      await Promise.all([once(shortSocket, "connect"), once(fullSocket, "connect")]);

      shortSocket.emit("room:join", { slug, mode });
      await once(shortSocket, "room:joined");
      await once(shortSocket, "room:update");
      fullSocket.emit("room:join", { slug, mode });
      await once(fullSocket, "room:joined");
      await once(fullSocket, "room:update");

      const shortFocus = untilStatus(shortSocket, "focus");
      const fullFocus = untilStatus(fullSocket, "focus");
      shortSocket.emit("room:submit-ticket", { body: "short personal block", personalDurationMinutes: 25 });
      fullSocket.emit("room:submit-ticket", { body: "full block task" });
      await withTimeout(shortFocus, TABLE_CYCLE_MS + 10000, "short-block ticket to see focus status");
      await withTimeout(fullFocus, TABLE_CYCLE_MS + 10000, "full-block ticket to see focus status");
      const focusStartedAt = Date.now();

      const shortCheckinAt = withTimeout(
        once(shortSocket, "room:checkin-request"),
        TABLE_CYCLE_MS,
        "short-block ticket to receive its first check-in ping",
      ).then(() => Date.now());
      const fullCheckinAt = withTimeout(
        once(fullSocket, "room:checkin-request"),
        TABLE_CYCLE_MS,
        "full-block ticket to receive its first check-in ping",
      ).then(() => Date.now());

      const [shortAt, fullAt] = await Promise.all([shortCheckinAt, fullCheckinAt]);

      // A full FOCUS_DURATION_MS block is TABLE_CYCLE_MS * 50/60; a 25-minute
      // personal block is exactly half that. The first ping lands at 40% of
      // whichever duration applies, so the short-block ping must land
      // meaningfully earlier than the full-block one, not at the same
      // table-wide instant.
      expect(shortAt - focusStartedAt).toBeLessThan(fullAt - focusStartedAt);
    } finally {
      shortSocket.close();
      fullSocket.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);
