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

async function getUserId(cookie: string): Promise<number> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: number };
  return body.id;
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type Ticket = { userId: number; body: string };
type RoomUpdate = { tickets: Ticket[]; leaderUserId: number | null };

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

function untilTicketBody(socket: Socket, userId: number, body: string): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      const mine = payload.tickets.find((t) => t.userId === userId);
      if (mine && mine.body === body) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// An unbounded wait would hang this test's own cleanup forever if the server
// never broadcast the expected state at all — same reasoning as every other
// file in this suite.
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

// Leader is deterministic (the earliest-boarded ticket for the cycle, per
// leaderUserId's tickets[0] — see src/rooms.ts), but which of two
// simultaneous submitters actually lands first is a genuine network race —
// the same nondeterminism spec/concurrent-tickets.test.ts already embraces
// for the 6-cap check. This test doesn't predict a winner; it proves both
// sockets converge on the *same* leaderUserId regardless of who that turns
// out to be, and that the leader seat doesn't move when the other user
// merely edits their own already-boarded ticket (an UPDATE, not a new INSERT
// — upsertTicket's ON CONFLICT path keeps the row's id, and therefore its
// position in listTickets' ORDER BY id ASC, unchanged).
it(
  "crowns the earliest-boarded ticket's owner as Leader, consistently across viewers, stable across a non-leader's edit",
  async () => {
    const slug = "hancock-l1";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`leader-a-${uid}`);
    const bCookie = await registerAndGetCookie(`leader-b-${uid}`);
    const aId = await getUserId(aCookie);
    const bId = await getUserId(bCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    try {
      await Promise.all([once(a, "connect"), once(b, "connect")]);
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");

      const aSeesBoth = untilTicketCount(a, 2);
      const bSeesBoth = untilTicketCount(b, 2);

      // Fired back-to-back with no await between them — same race shape as
      // spec/concurrent-tickets.test.ts.
      a.emit("room:submit-ticket", { body: `Draft intro for ${uid}` });
      b.emit("room:submit-ticket", { body: `Draft outline for ${uid}` });

      const [aResult, bResult] = await Promise.all([
        withTimeout(aSeesBoth, 10000, "a to see both boarded tickets"),
        withTimeout(bSeesBoth, 10000, "b to see both boarded tickets"),
      ]);

      expect(aResult.leaderUserId).not.toBeNull();
      expect(aResult.leaderUserId).toBe(bResult.leaderUserId);
      expect([aId, bId]).toContain(aResult.leaderUserId);

      const leaderUserId = aResult.leaderUserId!;
      const nonLeaderId = leaderUserId === aId ? bId : aId;
      const nonLeaderSocket = leaderUserId === aId ? b : a;
      const editedBody = `Revised outline for ${uid}`;

      const bothSeeEdit = Promise.all([untilTicketBody(a, nonLeaderId, editedBody), untilTicketBody(b, nonLeaderId, editedBody)]);
      nonLeaderSocket.emit("room:submit-ticket", { body: editedBody });
      const [aAfterEdit, bAfterEdit] = await withTimeout(bothSeeEdit, 10000, "both sockets to see the non-leader's edited ticket body");

      // Still exactly 2 tickets (an upsert, not a 3rd row) and the Leader seat
      // hasn't moved.
      expect(aAfterEdit.tickets.length).toBe(2);
      expect(aAfterEdit.leaderUserId).toBe(leaderUserId);
      expect(bAfterEdit.leaderUserId).toBe(leaderUserId);
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);
