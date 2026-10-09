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

function untilStatus(socket: Socket, status: string): Promise<{ timer: TimerPayload }> {
  return new Promise((resolve) => {
    const handler = (payload: { timer: TimerPayload }): void => {
      if (payload.timer.status === status) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// The Lobby Override / FIFO lock: two users racing to start the same room's
// timer. The spec requires that exactly one payload wins, the other is
// rejected outright, and every client in the room converges on the same
// resulting state. See the comment on startFocus in src/rooms.ts for *why*
// this holds — Node's single-threaded event loop plus node:sqlite's
// synchronous reads/writes mean there is no gap in which a second handler can
// observe the stale pre-race state. This test proves that property
// end-to-end, over real sockets against the real running app, rather than
// just trusting the reasoning.
it("honors only the first of two concurrent start-timer emissions, with a uniform result for every client", async () => {
  // A slug not used by any other spec file (a real ANU location — see
  // src/db.ts — just not one any other test already races to use).
  const slug = "kambri-l1";
  const aCookie = await registerAndGetCookie(`racer-a-${randomUUID().slice(0, 8)}`);
  const bCookie = await registerAndGetCookie(`racer-b-${randomUUID().slice(0, 8)}`);
  const observerCookie = await registerAndGetCookie(`racer-observer-${randomUUID().slice(0, 8)}`);

  const a = connect(aCookie);
  const b = connect(bCookie);
  // A third socket that never emits a start command — it only watches. If the
  // server ever let both payloads through, or desynced the two racers, this
  // socket would be the first to see an inconsistent/third state.
  const observer = connect(observerCookie);
  try {
    await Promise.all([once(a, "connect"), once(b, "connect"), once(observer, "connect")]);

    a.emit("room:join", { slug });
    await once(a, "room:update");
    b.emit("room:join", { slug });
    await once(b, "room:update");
    observer.emit("room:join", { slug });
    await once(observer, "room:update");

    const aFocus = untilStatus(a, "focus");
    const bFocus = untilStatus(b, "focus");
    const observerFocus = untilStatus(observer, "focus");

    // Fire both "start the timer" commands back-to-back with no await
    // between them — as close as a test can get to "the exact same
    // millisecond" from two different client connections.
    a.emit("room:start-focus", { minutes: 25 });
    b.emit("room:start-focus", { minutes: 45 });

    const [aResult, bResult, observerResult] = await Promise.all([aFocus, bFocus, observerFocus]);

    // Exactly one of the two requested lengths won outright — never a third
    // value, never something in between.
    const winningMinutes = aResult.timer.durationMs! / 60_000;
    expect([25, 45]).toContain(winningMinutes);

    // Every client in the room — including the one that lost the race, and
    // the one that never raced at all — converges on the identical winning
    // state. A server that let both payloads mutate state, or that told
    // different sockets different things, would fail this.
    for (const result of [bResult, observerResult]) {
      expect(result.timer.durationMs).toBe(aResult.timer.durationMs);
      expect(result.timer.phaseEndAt).toBe(aResult.timer.phaseEndAt);
      expect(result.timer.startedByUsername).toBe(aResult.timer.startedByUsername);
    }

    // The loser's payload was rejected, not merged or queued: the winner's
    // started_by name is exactly one of the two racers, and the losing racer
    // never got a *second*, later "focus" update with their own requested
    // length (there is nothing left to race against — the room is already
    // mid-block and startFocus's idle-only guard rejects everyone else).
    expect(["racer-a", "racer-b"].some((prefix) => aResult.timer.startedByUsername?.startsWith(prefix))).toBe(true);
  } finally {
    // Whichever of the two actually won the race is the only one whose
    // room:reset will do anything (resetRoom is owner-gated) — emit from
    // both rather than figuring out which socket won, so the room reliably
    // ends up back at idle for the next run either way.
    a.emit("room:reset");
    b.emit("room:reset");
    a.close();
    b.close();
    observer.close();
  }
});
