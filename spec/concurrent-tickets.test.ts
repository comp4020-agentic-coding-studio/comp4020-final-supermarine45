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

type Ticket = { userId: number; username: string; body: string };
type RoomUpdate = { tickets: Ticket[] };

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

// Every mutating handler in registerSocketHandlers runs inside Node's
// single-threaded event loop against synchronous node:sqlite reads/writes —
// the same guarantee spec/lobby-override-race.test.ts proves for the 6th-
// ticket cap. This test proves it generalizes below the cap too: two
// different users submitting tickets to the same table at the exact same
// moment both land as distinct rows, neither clobbering the other — the
// per-user-ticket analogue of the old per-user-vote proof this file replaces
// (tickets.user_id, like the old votes, is part of a UNIQUE key, so a naive
// read-then-write race could in principle let one submission overwrite the
// other's row if the two handlers ever interleaved).
it("lands two concurrent ticket submissions from different users as distinct, uncorrupted rows", async () => {
  // A slug not used by any other spec file (a real ANU location — see
  // src/db.ts). Freed up by this file replacing concurrent-edits.test.ts,
  // which used to claim it for the same reason.
  const slug = "chifley-l1";
  const mode = "writing";
  const uid = randomUUID().slice(0, 8);
  const aCookie = await registerAndGetCookie(`ticketer-a-${uid}`);
  const bCookie = await registerAndGetCookie(`ticketer-b-${uid}`);

  const a = connect(aCookie);
  const b = connect(bCookie);
  try {
    await Promise.all([once(a, "connect"), once(b, "connect")]);
    a.emit("room:join", { slug, mode });
    await once(a, "room:joined");
    b.emit("room:join", { slug, mode });
    await once(b, "room:joined");

    const bodyA = `Draft intro for ${uid}`;
    const bodyB = `Outline conclusion for ${uid}`;

    const aSeesBoth = untilTicketCount(a, 2);
    const bSeesBoth = untilTicketCount(b, 2);

    // Fired back-to-back with no await between them — as close as a test can
    // get to "the exact same millisecond" from two different sockets.
    a.emit("room:submit-ticket", { body: bodyA });
    b.emit("room:submit-ticket", { body: bodyB });

    const [aResult, bResult] = await Promise.all([aSeesBoth, bSeesBoth]);

    // Both bodies landed as their own rows — if the server ever lost one
    // submission to a race (e.g. both reading the "0 existing tickets" count
    // before either write lands), this would be stuck at 1 ticket instead,
    // or one body would have silently overwritten the other's.
    const sortByUser = (r: RoomUpdate) => [...r.tickets].sort((x, y) => x.userId - y.userId);
    expect(sortByUser(aResult)).toEqual(sortByUser(bResult));
    const ticketA = aResult.tickets.find((t) => t.body === bodyA);
    const ticketB = aResult.tickets.find((t) => t.body === bodyB);
    expect(ticketA).toBeTruthy();
    expect(ticketB).toBeTruthy();
    expect(ticketA!.userId).not.toBe(ticketB!.userId);
  } finally {
    a.close();
    b.close();
  }
});
