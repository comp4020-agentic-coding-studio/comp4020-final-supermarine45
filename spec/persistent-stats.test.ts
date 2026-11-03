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

// A fresh login mints a brand-new session row, distinct from the one
// registration made. Reading vfhCount back through *that* — rather than
// through the connection that earned it, which never closed — is what
// actually stands in for a stranger leaving and coming back later.
async function loginAndGetCookie(username: string, password: string): Promise<string> {
  const res = await fetch(new URL("/auth/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status, await res.text()).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

async function getMe(cookie: string): Promise<{ id: number; username: string; vfhCount: number | null; isGuest: boolean }> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type Ticket = { userId: number; stamp: string | null };
type RoomUpdate = { timer: { status: string }; tickets: Ticket[] };

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

function untilOwnTicketStamped(socket: Socket, userId: number): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.tickets.some((t) => t.userId === userId && t.stamp !== null)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// Drives a user through "the core thing": board a ticket, let the scheduler
// carry the table through a full focus block into break, then stamp. No
// manual start/reset exists anymore (Decision 2) — the cycle mark and the
// focus->break transition are both the scheduler's own, waited out for real
// rather than forced, same no-fake-timers convention this suite has always
// used.
async function earnOneVfh(cookie: string, slug: string, mode: string, stamp: "completed" | "partial"): Promise<void> {
  const { id: userId } = await getMe(cookie);
  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body: "Read two chapters" });
    await sawFocus;

    await untilStatus(socket, "break");

    // Confirm the stamp actually landed before closing the socket — closing
    // immediately after emit() can drop the packet before it flushes, same
    // hazard reconnect-sync.test.ts/latecomer-sync.test.ts guard against for
    // room:reset.
    const stamped = untilOwnTicketStamped(socket, userId);
    socket.emit("room:stamp-ticket", { stamp });
    await stamped;
  } finally {
    socket.close();
  }
}

// Boards a ticket and leaves before the block ends — the scheduler's own
// transitions keep running for the table regardless, but this socket is gone
// well before break, so there's nothing left to stamp.
async function boardThenLeaveEarly(cookie: string, slug: string, mode: string, waitMs: number): Promise<void> {
  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const sawFocus = untilStatus(socket, "focus");
    socket.emit("room:submit-ticket", { body: "Read two chapters" });
    await sawFocus;

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } finally {
    socket.close();
  }
}

// Crit 8's persistence spec, in this app's own terms: "a stranger can visit,
// do the core thing, and find their trace still there when they come back."
// The core thing here is a full focus block honestly checked out; the trace
// is a Verified Focus Hour.
it(
  "keeps a user's VFH count on their account across a fresh login",
  async () => {
    const username = `returner-${randomUUID().slice(0, 8)}`;
    const password = "password123";
    const registerCookie = await registerAndGetCookie(username);

    await earnOneVfh(registerCookie, "hedley-common", "silent", "completed");

    const returnCookie = await loginAndGetCookie(username, password);
    const me = await getMe(returnCookie);

    expect(me.isGuest).toBe(false);
    expect(me.vfhCount).toBe(1);
  },
  TABLE_CYCLE_MS * 2 + 20000,
);

// VFH is binary-per-block, not proportional to elapsed time (Decision 6) —
// staying the full 50 minutes and stamping is what earns it, nothing less.
// Leaving mid-block, even most of the way through, earns exactly 0: the tab-
// penalty demotion path (applyTabPenalty -> markTicketNotFullBlock) is the
// server-side enforcement; this proves the plain "disconnected before break"
// case the same path exists to cover.
it(
  "earns zero VFH for a ticket whose holder left before the block ended",
  async () => {
    const username = `leaver-${randomUUID().slice(0, 8)}`;
    const password = "password123";
    const cookie = await registerAndGetCookie(username);

    // Leaves partway through the focus block, well before break — long
    // enough to be a meaningful "mostly stayed", short enough to stay inside
    // a single test-speed focus block.
    await boardThenLeaveEarly(cookie, "hedley-l2", "silent", Math.min(1500, Math.floor(TABLE_CYCLE_MS / 4)));

    const returnCookie = await loginAndGetCookie(username, password);
    const me = await getMe(returnCookie);

    expect(me.vfhCount).toBe(0);
  },
  TABLE_CYCLE_MS + 20000,
);

// A counter that merges everyone's cycles into one global total, or credits
// the wrong account, would pass the single-user test above just as easily.
// Two different users, at two different tables, one who stamps and one who
// never does, is what actually rules that out.
it(
  "tracks two different users' VFH independently, crediting only the one who stamped",
  async () => {
    const password = "password123";
    const usernameA = `vfh-a-${randomUUID().slice(0, 8)}`;
    const usernameB = `vfh-b-${randomUUID().slice(0, 8)}`;

    const cookieA = await registerAndGetCookie(usernameA);
    const cookieB = await registerAndGetCookie(usernameB);

    const bSocket = connect(cookieB);
    try {
      await Promise.all([
        earnOneVfh(cookieA, "robertson-common", "silent", "completed"),
        (async () => {
          // B stays the full block but never stamps during break — a ticket
          // that's eligible (stayedFullBlock) but un-stamped still earns
          // nothing, since getVfhCount requires stamp IS NOT NULL too.
          await once(bSocket, "connect");
          bSocket.emit("room:join", { slug: "chifley-lg", mode: "silent" });
          await once(bSocket, "room:joined");
          await once(bSocket, "room:update");
          const sawFocus = untilStatus(bSocket, "focus");
          bSocket.emit("room:submit-ticket", { body: "Read two chapters" });
          await sawFocus;
          await untilStatus(bSocket, "break");
        })(),
      ]);

      const meA = await getMe(await loginAndGetCookie(usernameA, password));
      const meB = await getMe(await loginAndGetCookie(usernameB, password));

      expect(meA.username).toBe(usernameA);
      expect(meB.username).toBe(usernameB);
      expect(meA.vfhCount).toBe(1);
      expect(meB.vfhCount).toBe(0);
    } finally {
      bSocket.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 20000,
);
