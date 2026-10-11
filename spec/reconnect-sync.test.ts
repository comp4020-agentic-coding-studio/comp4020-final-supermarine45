import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";

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
  startedByUsername: string | null;
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

// The shared timer is room state, not per-socket state — leaveRoom only ever
// touches `presence`/`shadowCounts` and re-broadcasts, so one participant
// dropping out can never be the thing that resets or nudges someone else's
// countdown. This proves it end-to-end rather than just trusting the code.
it("leaves the timer untouched when a participant disconnects mid-focus", async () => {
  const slug = "marie-reay-l1";
  const p1Cookie = await registerAndGetCookie(`p1-${randomUUID().slice(0, 8)}`);
  const p2Cookie = await registerAndGetCookie(`p2-${randomUUID().slice(0, 8)}`);
  const observerCookie = await registerAndGetCookie(`observer-${randomUUID().slice(0, 8)}`);

  const p1 = connect(p1Cookie);
  const p2 = connect(p2Cookie);
  // Watches only — never starts or stops anything, so if a disconnect ever
  // leaked into the timer, this socket would be the one to see it.
  const observer = connect(observerCookie);
  try {
    await Promise.all([once(p1, "connect"), once(p2, "connect"), once(observer, "connect")]);
    p1.emit("room:join", { slug });
    await once(p1, "room:update");
    p2.emit("room:join", { slug });
    await once(p2, "room:update");
    observer.emit("room:join", { slug });
    await once(observer, "room:update");

    p1.emit("room:start-focus", { minutes: 25 });
    const focusState = await untilStatus(observer, "focus");
    // p1, p2, and the observer itself are all signed-in and in the roster.
    expect(focusState.roster).toHaveLength(3);

    const afterDisconnect = once<{ timer: TimerPayload; roster: unknown[] }>(observer, "room:update");
    p2.close();
    const result = await afterDisconnect;

    expect(result.roster).toHaveLength(2);
    expect(result.timer.status).toBe(focusState.timer.status);
    expect(result.timer.phaseEndAt).toBe(focusState.timer.phaseEndAt);
    expect(result.timer.durationMs).toBe(focusState.timer.durationMs);
    expect(result.timer.startedByUsername).toBe(focusState.timer.startedByUsername);
  } finally {
    // Closing p1 immediately after emit() can drop the reset packet before
    // it flushes, leaving the room stuck mid-focus for the next run against
    // this same long-lived dev server — wait for observer's own idle
    // broadcast first.
    const observerSawIdle = untilStatus(observer, "idle");
    p1.emit("room:reset");
    await observerSawIdle;
    p1.close();
    observer.close();
  }
});

// room.js re-emits room:join on every "connect" — including a
// socket.io-client reconnection — and room:join always recomputes state from
// the authoritative phase_end_at rather than anything cached client-side.
// This proves that holds for an actual dropped-and-reopened connection from
// the same user, not just a fresh second user joining mid-block
// (latecomer-sync.test.ts).
it("resyncs a reconnecting user to the authoritative countdown instead of restarting it", async () => {
  const slug = "kambri-l2";
  const cookie = await registerAndGetCookie(`reconnector-${randomUUID().slice(0, 8)}`);

  const first = connect(cookie);
  try {
    await once(first, "connect");
    first.emit("room:join", { slug });
    await once(first, "room:update");

    const beforeStart = Date.now();
    first.emit("room:start-focus", { minutes: 25 });
    const started = await once<{ timer: TimerPayload }>(first, "room:update");
    expect(started.timer.status).toBe("focus");

    // Real elapsed time before the "drop", so the countdown the reconnection
    // gets back must be measurably less than a full fresh block.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Simulates a closed tab / dropped connection — not a graceful leave.
    first.close();

    const second = connect(cookie);
    try {
      await once(second, "connect");
      const rejoinedAt = Date.now();
      second.emit("room:join", { slug });
      const state = await once<{ timer: TimerPayload }>(second, "room:update");

      expect(state.timer.status).toBe("focus");
      const remainingAtRejoin = state.timer.phaseEndAt! - rejoinedAt;
      const elapsedSinceStart = rejoinedAt - beforeStart;
      const expectedRemaining = state.timer.durationMs! - elapsedSinceStart;

      // Within a couple of seconds of network/scheduling jitter, not a full
      // fresh block — this is what distinguishes "resynced" from "restarted".
      expect(Math.abs(remainingAtRejoin - expectedRemaining)).toBeLessThan(2000);
      expect(remainingAtRejoin).toBeLessThan(state.timer.durationMs! - 1000);
    } finally {
      // Closing second immediately after emit() can drop the reset packet
      // before it flushes, so wait for second's own idle broadcast first.
      const secondSawIdle = untilStatus(second, "idle");
      second.emit("room:reset");
      await secondSawIdle;
      second.close();
    }
  } finally {
    first.close();
  }
});
