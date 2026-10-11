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

function untilVoteCount(
  socket: Socket,
  minutes: number,
  count: number,
): Promise<{ votes: { minutes: number; count: number }[] }> {
  return new Promise((resolve) => {
    const handler = (payload: { votes: { minutes: number; count: number }[] }): void => {
      if (payload.votes.some((v) => v.minutes === minutes && v.count === count)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

type Goal = { id: number; body: string; done: boolean };

// Resolves on the Nth room:update this socket receives from the moment it's
// called, not the Nth overall — lets a test fire two mutations back-to-back
// with no await between them and still observe both resulting broadcasts in
// order, the same way lobby-override-race.test.ts observes two racing
// start-focus payloads.
function nthRoomUpdate(socket: Socket, n: number): Promise<{ goals: Goal[] }> {
  let seen = 0;
  return new Promise((resolve) => {
    const handler = (payload: { goals: Goal[] }): void => {
      seen++;
      if (seen === n) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// Every mutating handler in registerSocketHandlers runs inside Node's
// single-threaded event loop against synchronous node:sqlite reads/writes —
// the same guarantee spec/lobby-override-race.test.ts proves for
// room:start-focus. These two tests prove it generalizes to goal toggles and
// lobby votes too: two "simultaneous" edits from two different sockets are
// always serialized, never lost to a race, and every client converges on the
// identical final state.

it("serializes two concurrent goal-toggle emissions so both sockets converge on the same final state", async () => {
  const slug = "chifley-l1";
  const aCookie = await registerAndGetCookie(`toggler-a-${randomUUID().slice(0, 8)}`);
  const bCookie = await registerAndGetCookie(`toggler-b-${randomUUID().slice(0, 8)}`);

  const a = connect(aCookie);
  const b = connect(bCookie);
  try {
    await Promise.all([once(a, "connect"), once(b, "connect")]);
    a.emit("room:join", { slug });
    await once(a, "room:update");
    b.emit("room:join", { slug });
    await once(b, "room:update");

    const goalBody = `read chapter ${randomUUID().slice(0, 8)}`;
    a.emit("room:goal-add", { body: goalBody });
    // Wait for BOTH sockets' copies of this broadcast, not just a's — a's own
    // emit resolves as soon as its copy lands, but b's copy of the same
    // message can still be in flight over its own connection. Without this,
    // the nthRoomUpdate counters below could catch that late-arriving copy as
    // one of the "two toggle" broadcasts instead of the goal-add echo.
    const [added] = await Promise.all([
      once<{ goals: Goal[] }>(a, "room:update"),
      once<{ goals: Goal[] }>(b, "room:update"),
    ]);
    const goal = added.goals.find((g) => g.body === goalBody);
    expect(goal).toBeTruthy();
    expect(goal!.done).toBe(false);
    const goalId = goal!.id;

    // Registered before either toggle fires, so both of the resulting
    // broadcasts are counted rather than one being missed in the gap.
    const aAfterBoth = nthRoomUpdate(a, 2);
    const bAfterBoth = nthRoomUpdate(b, 2);

    // Fired back-to-back with no await between them — as close as a test
    // can get to "the exact same millisecond" from two different sockets.
    a.emit("room:goal-toggle", { id: goalId });
    b.emit("room:goal-toggle", { id: goalId });

    const [aResult, bResult] = await Promise.all([aAfterBoth, bAfterBoth]);

    // Two toggles of the same goal cancel out — if the server ever lost one
    // toggle to a race, this would land on `true` instead.
    const aGoal = aResult.goals.find((g) => g.id === goalId);
    const bGoal = bResult.goals.find((g) => g.id === goalId);
    expect(aGoal?.done).toBe(false);
    expect(bGoal?.done).toBe(false);
    expect(aResult.goals).toEqual(bResult.goals);
  } finally {
    a.close();
    b.close();
  }
});

it("lands both of two concurrent votes from different users in the same tally", async () => {
  const slug = "law-l3";
  const aCookie = await registerAndGetCookie(`voter-a-${randomUUID().slice(0, 8)}`);
  const bCookie = await registerAndGetCookie(`voter-b-${randomUUID().slice(0, 8)}`);

  const a = connect(aCookie);
  const b = connect(bCookie);
  try {
    await Promise.all([once(a, "connect"), once(b, "connect")]);
    a.emit("room:join", { slug });
    await once(a, "room:update");
    b.emit("room:join", { slug });
    await once(b, "room:update");

    a.emit("room:start-lobby");
    await untilStatus(a, "lobby");
    await untilStatus(b, "lobby");

    // Resolves once a's 25-minute vote has landed. 45 only reaches count 1
    // once both votes have been processed, since 25 is cast first — waiting
    // on it is equivalent to waiting for both to have landed.
    const bothLanded = untilVoteCount(a, 45, 1);

    // Fired back-to-back with no await between them, from two different
    // users — votes are keyed per-user, so unlike the goal toggles above
    // neither should overwrite the other.
    a.emit("room:vote", { minutes: 25 });
    b.emit("room:vote", { minutes: 45 });

    const result = await bothLanded;
    const twentyFive = result.votes.find((v) => v.minutes === 25);
    const fortyFive = result.votes.find((v) => v.minutes === 45);
    expect(twentyFive?.count).toBe(1);
    expect(fortyFive?.count).toBe(1);
  } finally {
    // Closing a immediately after emit() can drop the reset packet before it
    // flushes, leaving the room stuck in "lobby" for the next run against
    // this same long-lived dev server — wait for b's own idle broadcast first.
    const bSawIdle = untilStatus(b, "idle");
    a.emit("room:reset");
    await bSawIdle;
    a.close();
    b.close();
  }
});
