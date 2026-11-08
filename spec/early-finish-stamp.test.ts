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

async function getMe(cookie: string): Promise<{ id: number; vfhCount: number }> {
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
type RoomError = { error: string; action: string };

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

function untilStamped(socket: Socket, userId: number, stamp: string): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.tickets.some((t) => t.userId === userId && t.stamp === stamp)) {
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

// room:stamp-ticket's narrow carve-out (src/rooms.ts, ~line 1132): a
// personal-duration ticket may stamp mid-focus once its own shorter block has
// elapsed, even though the table itself is still "focus" for everyone else.
// A 25-minute personal block is half of FOCUS_DURATION_MS, so it's
// comfortably elapsed well before the table-wide focus block ends — this
// proves the stamp succeeds right there, during focus, not just once the
// table itself reaches break. It also proves VFH is credited immediately
// off that early stamp (getVfhCount has no duration-based exclusion — a
// personal-duration ticket counts exactly like a full-block one), and that
// the credit survives disconnecting right after without ever reaching break
// or reboarding — closing the "VFH only counts if you keep going" gap.
it(
  "allows stamping a personal-duration ticket once its own block is up, while the table is still in focus, and credits VFH immediately even if the user disconnects right after",
  async () => {
    const slug = "chifley-l1";
    const username = `early-finish-${randomUUID().slice(0, 8)}`;
    const cookie = await registerAndGetCookie(username);
    const { id: myUserId } = await getMe(cookie);

    const socket = connect(cookie);
    socket.on("room:checkin-request", () => socket.emit("room:checkin-confirm"));
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "quarter-block read", personalDurationMinutes: 25 });
      const focusPayload = await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "socket to see focus status");
      const focusStartedAt = Date.now();
      void focusPayload;

      // A 25-minute preset is half of FOCUS_DURATION_MS — wait past that
      // point (plus slack) while staying well short of the full focus block.
      const personalDurationMs = (TABLE_CYCLE_MS * (50 / 60)) / 2;
      const elapsed = Date.now() - focusStartedAt;
      const remaining = personalDurationMs - elapsed + 2000;
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

      const stamped = untilStamped(socket, myUserId, "completed");
      socket.emit("room:stamp-ticket", { stamp: "completed" });
      const stampedPayload = await withTimeout(stamped, 5000, "ticket to be stamped completed during focus");
      expect(stampedPayload.timer.status).toBe("focus");

      // Disconnect immediately — no reboard, no riding out the rest of focus
      // or break. VFH must already be there on a fresh read.
      socket.close();
      const { vfhCount } = await getMe(cookie);
      expect(vfhCount).toBe(1);
    } finally {
      socket.close();
    }
  },
  TABLE_CYCLE_MS + 30000,
);

// The carve-out is time-gated, not merely duration-type-gated: a
// personal-duration ticket stamped before its own shorter block has actually
// elapsed is still rejected with not_breaking while the table is in focus,
// same as an ordinary full-block ticket.
it(
  "rejects stamping a personal-duration ticket during focus before its own block has elapsed",
  async () => {
    const slug = "chifley-l3";
    const username = `too-soon-${randomUUID().slice(0, 8)}`;
    const cookie = await registerAndGetCookie(username);

    const socket = connect(cookie);
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "quarter-block read", personalDurationMinutes: 25 });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "socket to see focus status");

      const stampRejection = once<RoomError>(socket, "room:error");
      socket.emit("room:stamp-ticket", { stamp: "completed" });
      const stampPayload = await withTimeout(stampRejection, 5000, "room:error for stamp-ticket before personal duration elapses");
      expect(stampPayload).toEqual({ error: "not_breaking", action: "room:stamp-ticket" });
    } finally {
      socket.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);
