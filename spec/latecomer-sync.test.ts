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

type RoomUpdate = { timer: { status: string; phaseEndAt: number; durationMs: number } };

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

// No manual room:start-focus exists anymore (Decision 2) — the only way to
// get a table into 'focus' is to board a ticket and wait for the scheduler's
// own cycle mark, same as a real user would. Worst case, submitting the
// ticket lands just after a mark already fired with nobody boarded (that mark
// no-ops and simply re-arms — see beginScheduledFocus), so the test may have
// to wait out two full cycles, not one; the timeout below accounts for that
// rather than assuming the lucky case.
it(
  "gives a user who joins mid-block the server's authoritative remaining time",
  async () => {
    const slug = "marie-reay";
    const mode = "silent";
    const starterCookie = await registerAndGetCookie(`starter-${randomUUID().slice(0, 8)}`);
    const latecomerCookie = await registerAndGetCookie(`latecomer-${randomUUID().slice(0, 8)}`);

    const starter = connect(starterCookie);
    try {
      await once(starter, "connect");
      starter.emit("room:join", { slug, mode });
      await once(starter, "room:joined");
      await once(starter, "room:update"); // initial idle state

      const sawFocus = untilStatus(starter, "focus");
      starter.emit("room:submit-ticket", { body: "Read two chapters" });
      const started = await sawFocus;
      expect(started.timer.status).toBe("focus");

      // The server's own cycle mark decides when the block actually began,
      // not the moment this test called emit() — unlike the old manual-start
      // version, phaseStartedAt isn't "now" at submission time. Deriving it
      // from the broadcast itself (phaseEndAt - durationMs) is exact, not an
      // approximation from a client-side clock.
      const beforeStart = started.timer.phaseEndAt - started.timer.durationMs;

      // Wait a real slice of the block before the second user joins, so the
      // remaining time it gets back must be measurably less than a full
      // block. Scaled off FOCUS_DURATION_MS (capped at the old fixed 2s) so
      // this stays meaningful under a short test-speed cycle instead of
      // eating most of a several-second CI focus block.
      const waitMs = Math.min(2000, Math.floor(FOCUS_DURATION_MS / 3));
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      const latecomer = connect(latecomerCookie);
      try {
        await once(latecomer, "connect");
        const joinedAt = Date.now();
        latecomer.emit("room:join", { slug, mode });
        await once(latecomer, "room:joined");
        const state = await once<RoomUpdate>(latecomer, "room:update");

        expect(state.timer.status).toBe("focus");
        const remainingAtJoin = state.timer.phaseEndAt - joinedAt;
        const elapsedSinceStart = joinedAt - beforeStart;
        const expectedRemaining = state.timer.durationMs - elapsedSinceStart;

        // Within a couple of seconds of network/scheduling jitter, not a full
        // fresh block — this is what distinguishes "synced" from "restarted".
        expect(Math.abs(remainingAtJoin - expectedRemaining)).toBeLessThan(2000);
        expect(remainingAtJoin).toBeLessThan(state.timer.durationMs - 1000);
      } finally {
        latecomer.close();
      }
    } finally {
      // No manual reset exists anymore (Decision 2) — the table simply stays
      // mid-focus/break until its own cycle mark rolls it over naturally.
      // Just disconnect; there's nothing left to tear down server-side.
      starter.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);
