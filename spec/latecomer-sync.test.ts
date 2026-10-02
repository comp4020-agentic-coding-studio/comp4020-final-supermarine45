import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await fetch(new URL("/auth/register", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password123" }),
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

it("gives a user who joins mid-block the server's authoritative remaining time", async () => {
  const slug = "marie-reay";
  const starterCookie = await registerAndGetCookie(`starter-${randomUUID().slice(0, 8)}`);
  const latecomerCookie = await registerAndGetCookie(`latecomer-${randomUUID().slice(0, 8)}`);

  const starter = connect(starterCookie);
  try {
    await once(starter, "connect");
    starter.emit("room:join", { slug });
    await once(starter, "room:update"); // initial idle state

    const beforeStart = Date.now();
    starter.emit("room:start-focus");
    const started = await once<{ timer: { status: string; phaseEndAt: number; durationMs: number } }>(
      starter,
      "room:update",
    );
    expect(started.timer.status).toBe("focus");

    // Wait a couple of real seconds before the second user joins, so the
    // remaining time it gets back must be measurably less than a full block.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const latecomer = connect(latecomerCookie);
    try {
      await once(latecomer, "connect");
      const joinedAt = Date.now();
      latecomer.emit("room:join", { slug });
      const state = await once<{ timer: { status: string; phaseEndAt: number; durationMs: number } }>(
        latecomer,
        "room:update",
      );

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
    starter.close();
  }
});
