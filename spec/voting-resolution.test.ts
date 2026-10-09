import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { resolveVotes } from "../src/rooms.js";

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

type VotePayload = { timer: { status: string }; votes: { minutes: number; count: number }[] };

function untilVoteCount(socket: Socket, minutes: number, count: number): Promise<VotePayload> {
  return new Promise((resolve) => {
    const handler = (payload: VotePayload): void => {
      if (payload.votes.some((v) => v.minutes === minutes && v.count === count)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// The winner-selection logic is the part a 30-minute real grid mark makes
// impractical to exercise end-to-end in a fast test, so it's pulled out as a
// pure function and asserted directly: highest count wins, and a tie breaks
// toward the shorter preset rather than toward whoever voted first.
it("resolves a vote tally to the highest count, breaking ties toward the shorter preset", () => {
  expect(resolveVotes(new Map([[25, 3], [45, 1]]))).toBe(25);
  expect(resolveVotes(new Map([[15, 2], [50, 2]]))).toBe(15);
  expect(resolveVotes(new Map())).toBe(25);
});

// The live parts — starting a lobby, casting and re-casting votes, and the
// broadcast tally everyone in the room sees — are exercised over real sockets
// against the running app, same as the rest of this spec suite.
it("broadcasts a live, re-votable tally while a room is in its lobby", async () => {
  // A slug not used by any other spec file: tests across files can run
  // concurrently against the same live server, and a shared room would let
  // one file's lobby/vote state bleed into another's assertions.
  const slug = "law";
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
    const lobby = await untilStatus(a, "lobby");
    expect(lobby.timer.status).toBe("lobby");
    await untilStatus(b, "lobby");

    a.emit("room:vote", { minutes: 25 });
    await untilVoteCount(b, 25, 1);

    b.emit("room:vote", { minutes: 25 });
    await untilVoteCount(a, 25, 2);

    // Re-casting a vote changes the voter's own count rather than adding a
    // second one — the tally reflects one vote per person, not per cast.
    b.emit("room:vote", { minutes: 45 });
    const resolved = await untilVoteCount(a, 45, 1);
    const twentyFive = resolved.votes.find((v) => v.minutes === 25);
    expect(twentyFive?.count).toBe(1);
  } finally {
    a.emit("room:reset");
    a.close();
    b.close();
  }
});
