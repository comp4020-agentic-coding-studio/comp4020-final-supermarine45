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

type RoomUpdate = {
  tickets: Array<{ userId: number; username: string }>;
};

type RoomError = { error: string; action: string };

function untilTicketCount(socket: Socket, count: number): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.tickets.length === count) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// An unbounded wait would hang this test's own cleanup forever if the server
// never sent the loser's rejection at all — see its one call site below.
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

// The Table's 6-cap FIFO lock: two sockets racing to submit a table's 6th
// ticket back-to-back. The spec requires that exactly one submission wins,
// the other is rejected outright with `table_full`, and every client at the
// table converges on the same final 6-ticket roster. See the comment on
// room:submit-ticket in src/rooms.ts for *why* this holds — Node's
// single-threaded event loop plus node:sqlite's synchronous reads/writes mean
// there is no gap in which a second handler can observe the stale, pre-race
// ticket count. This test proves that property end-to-end, over real sockets
// against the real running app, rather than just trusting the reasoning.
it("honors only the first of two concurrent 6th-ticket submissions, with a uniform result for every client", async () => {
  // A slug not used by any other spec file (a real ANU location — see
  // src/db.ts), paired with a mode no other test races on. "silent" has no
  // solo/collab split, which keeps this race free of unrelated subphase
  // broadcasts.
  const slug = "kambri-l1";
  const mode = "silent";
  const uid = randomUUID().slice(0, 8);

  const fillerCookies = await Promise.all(
    Array.from({ length: 5 }, (_, i) => registerAndGetCookie(`filler-${i}-${uid}`)),
  );
  const [aCookie, bCookie, observerCookie] = await Promise.all([
    registerAndGetCookie(`racer-a-${uid}`),
    registerAndGetCookie(`racer-b-${uid}`),
    registerAndGetCookie(`racer-observer-${uid}`),
  ]);

  const fillers = fillerCookies.map(connect);
  const a = connect(aCookie);
  const b = connect(bCookie);
  // A third socket that never races — it only watches. If the server ever let
  // both submissions through, or desynced the two racers, this socket would
  // be the first to see an inconsistent (or seven-ticket) table.
  const observer = connect(observerCookie);
  const everyone = [...fillers, a, b, observer];

  try {
    await Promise.all(everyone.map((s) => once(s, "connect")));
    for (const s of everyone) s.emit("room:join", { slug, mode });
    await Promise.all(everyone.map((s) => once(s, "room:joined")));

    // Board 5 of the 6 seats, one ticket per filler, fired together rather
    // than one round-trip at a time (each filler targets a distinct user's
    // own ticket row, so concurrent submission can't collide below the cap —
    // only the race for the 6th slot below needs strict ordering). Keeping
    // this fast matters against a short test-speed TABLE_CYCLE_MS: the whole
    // sequence needs to land comfortably inside one hourly cycle, since
    // straddling a cycle mark would roll cycleStartAt over mid-test.
    const fifthBoarded = untilTicketCount(observer, 5);
    for (let i = 0; i < fillers.length; i++) {
      fillers[i].emit("room:submit-ticket", { body: `Filler ticket ${i}` });
    }
    await fifthBoarded;

    const aErrors: RoomError[] = [];
    const bErrors: RoomError[] = [];
    const aErrored = new Promise<RoomError>((resolve) => {
      a.on("room:error", (e: RoomError) => {
        aErrors.push(e);
        resolve(e);
      });
    });
    const bErrored = new Promise<RoomError>((resolve) => {
      b.on("room:error", (e: RoomError) => {
        bErrors.push(e);
        resolve(e);
      });
    });

    const aFull = untilTicketCount(a, 6);
    const bFull = untilTicketCount(b, 6);
    const observerFull = untilTicketCount(observer, 6);

    // Fire both "submit the 6th ticket" commands back-to-back with no await
    // between them — as close as a test can get to "the exact same
    // millisecond" from two different client connections.
    a.emit("room:submit-ticket", { body: "Racer A's ticket" });
    b.emit("room:submit-ticket", { body: "Racer B's ticket" });

    const [aResult, bResult, observerResult] = await Promise.all([aFull, bFull, observerFull]);

    // Every client at the table — including the one that lost the race, and
    // the one that never raced at all — converges on the identical final
    // 6-ticket roster. A server that let both submissions through (a 7th
    // ticket), or that told different sockets different things, would fail
    // this.
    const finalIds = (r: RoomUpdate) => r.tickets.map((t) => t.userId).sort();
    expect(aResult.tickets).toHaveLength(6);
    expect(finalIds(bResult)).toEqual(finalIds(aResult));
    expect(finalIds(observerResult)).toEqual(finalIds(aResult));

    // Exactly one racer was rejected outright (never both, never neither),
    // and the one that wasn't rejected is exactly the one whose ticket
    // actually landed in the final roster — ties the error bookkeeping
    // directly to the observed table state rather than checking them in
    // isolation.
    const usernames = aResult.tickets.map((t) => t.username);
    const aWon = usernames.some((u) => u.startsWith("racer-a"));
    const bWon = usernames.some((u) => u.startsWith("racer-b"));
    expect(aWon !== bWon).toBe(true);

    // The roster converging only tells us who won — it says nothing about
    // whether the loser's own room:error packet has arrived yet. That's a
    // separate, unicast emit with no ordering guarantee relative to the
    // winner's room:update, which the loser also receives (both racers share
    // the table's Socket.IO room), so aFull/bFull above can resolve before
    // the loser's rejection lands. Wait for it explicitly rather than reading
    // aErrors/bErrors.length at whatever moment the roster happened to settle.
    if (aWon) {
      await withTimeout(bErrored, 5000, "racer B's table_full rejection");
    } else {
      await withTimeout(aErrored, 5000, "racer A's table_full rejection");
    }

    expect(aWon).toBe(aErrors.length === 0);
    expect(bWon).toBe(bErrors.length === 0);
    for (const err of [...aErrors, ...bErrors]) {
      expect(err).toEqual({ error: "table_full", action: "room:submit-ticket" });
    }
  } finally {
    // No manual reset exists anymore (Decision 2: nobody can end a table's
    // cycle early) — the table's ticket count for this cycle simply stays at
    // 6 until the next hourly cycle mark rolls it over naturally. Just close
    // every socket; there is nothing left to tear down server-side.
    for (const s of everyone) s.close();
  }
});
