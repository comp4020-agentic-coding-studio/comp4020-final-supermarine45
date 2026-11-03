import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { FOCUS_DURATION_MS, TABLE_CYCLE_MS } from "../src/rooms.js";

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

type TimerPayload = {
  status: string;
  phaseEndAt: number | null;
  durationMs: number | null;
};

function untilStatus(socket: Socket, status: string): Promise<{ timer: TimerPayload; roster: unknown[] }> {
  return new Promise((resolve) => {
    const handler = (payload: { timer: TimerPayload; roster: unknown[] }): void => {
      if (payload.timer.status === status) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// The shared timer is table state, not per-socket state — leaveTable only
// ever touches `presence`/`shadowCounts` and re-broadcasts, so one
// participant dropping out can never be the thing that resets or nudges
// someone else's countdown. This proves it end-to-end rather than just
// trusting the code.
it(
  "leaves the timer untouched when a participant disconnects mid-focus",
  async () => {
    const slug = "marie-reay-l1";
    const mode = "silent";
    const p1Cookie = await registerAndGetCookie(`p1-${randomUUID().slice(0, 8)}`);
    const p2Cookie = await registerAndGetCookie(`p2-${randomUUID().slice(0, 8)}`);
    const observerCookie = await registerAndGetCookie(`observer-${randomUUID().slice(0, 8)}`);

    const p1 = connect(p1Cookie);
    const p2 = connect(p2Cookie);
    // Watches only — never submits a ticket, so if a disconnect ever leaked
    // into the timer, this socket would be the one to see it.
    const observer = connect(observerCookie);
    try {
      await Promise.all([once(p1, "connect"), once(p2, "connect"), once(observer, "connect")]);
      p1.emit("room:join", { slug, mode });
      await once(p1, "room:joined");
      await once(p1, "room:update");
      p2.emit("room:join", { slug, mode });
      await once(p2, "room:joined");
      await once(p2, "room:update");
      observer.emit("room:join", { slug, mode });
      await once(observer, "room:joined");
      await once(observer, "room:update");

      // No manual start exists anymore (Decision 2) — one boarded ticket is
      // enough for the scheduler's own cycle mark to bring the table into
      // focus for everyone at it.
      const focusSeen = untilStatus(observer, "focus");
      p1.emit("room:submit-ticket", { body: "Read two chapters" });
      const focusState = await focusSeen;
      // p1, p2, and the observer itself are all signed-in and in the roster.
      expect(focusState.roster).toHaveLength(3);

      const afterDisconnect = once<{ timer: TimerPayload; roster: unknown[] }>(observer, "room:update");
      p2.close();
      const result = await afterDisconnect;

      expect(result.roster).toHaveLength(2);
      expect(result.timer.status).toBe(focusState.timer.status);
      expect(result.timer.phaseEndAt).toBe(focusState.timer.phaseEndAt);
      expect(result.timer.durationMs).toBe(focusState.timer.durationMs);
    } finally {
      // No manual reset exists anymore (Decision 2) — the table simply stays
      // mid-focus/break until its own cycle mark rolls it over naturally.
      // Just disconnect; there's nothing left to tear down server-side.
      p1.close();
      observer.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);

// room.js re-emits room:join on every "connect" — including a
// socket.io-client reconnection — and room:join always recomputes state from
// the authoritative phase_end_at rather than anything cached client-side.
// This proves that holds for an actual dropped-and-reopened connection from
// the same user, not just a fresh second user joining mid-block
// (latecomer-sync.test.ts).
it(
  "resyncs a reconnecting user to the authoritative countdown instead of restarting it",
  async () => {
    const slug = "kambri-l2";
    const mode = "silent";
    const cookie = await registerAndGetCookie(`reconnector-${randomUUID().slice(0, 8)}`);

    const first = connect(cookie);
    try {
      await once(first, "connect");
      first.emit("room:join", { slug, mode });
      await once(first, "room:joined");
      await once(first, "room:update");

      const sawFocus = untilStatus(first, "focus");
      first.emit("room:submit-ticket", { body: "Read two chapters" });
      const started = await sawFocus;
      expect(started.timer.status).toBe("focus");

      // Derived from the broadcast itself (phaseEndAt - durationMs), not
      // Date.now() at submission time — the scheduler's own cycle mark
      // decides when the block actually began, which can lag a ticket
      // submission by up to the remainder of the current cycle.
      const beforeStart = started.timer.phaseEndAt! - started.timer.durationMs!;

      // Real elapsed time before the "drop", so the countdown the
      // reconnection gets back must be measurably less than a full fresh
      // block. Scaled off FOCUS_DURATION_MS so this stays meaningful under a
      // short test-speed cycle instead of eating most of it.
      const waitMs = Math.min(1500, Math.floor(FOCUS_DURATION_MS / 3));
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      // Simulates a closed tab / dropped connection — not a graceful leave.
      first.close();

      const second = connect(cookie);
      try {
        await once(second, "connect");
        const rejoinedAt = Date.now();
        second.emit("room:join", { slug, mode });
        await once(second, "room:joined");
        const state = await once<{ timer: TimerPayload }>(second, "room:update");

        expect(state.timer.status).toBe("focus");
        const remainingAtRejoin = state.timer.phaseEndAt! - rejoinedAt;
        const elapsedSinceStart = rejoinedAt - beforeStart;
        const expectedRemaining = state.timer.durationMs! - elapsedSinceStart;

        // Within a couple of seconds of network/scheduling jitter, not a full
        // fresh block — this is what distinguishes "resynced" from
        // "restarted".
        expect(Math.abs(remainingAtRejoin - expectedRemaining)).toBeLessThan(2000);
        expect(remainingAtRejoin).toBeLessThan(state.timer.durationMs! - 1000);
      } finally {
        // No manual reset exists anymore (Decision 2) — just disconnect.
        second.close();
      }
    } finally {
      first.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);
