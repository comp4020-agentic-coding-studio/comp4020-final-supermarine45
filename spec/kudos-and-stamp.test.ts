import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";
import { CHECKIN_GRACE_MS, TABLE_CYCLE_MS } from "../src/rooms.js";

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

async function getMe(cookie: string): Promise<{ id: number; vfhCount: number | null }> {
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

type Kudos = { fromUserId: number; emoji: string };
type Ticket = { userId: number; stamp: string | null; kudos: Kudos[] };
type RoomUpdate = { timer: { status: string }; tickets: Ticket[] };
type RoomError = { error: string; action: string };
type RosterEntry = { username: string };

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

function untilKudosFrom(socket: Socket, ticketUserId: number, fromUserId: number): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      const ticket = payload.tickets.find((t) => t.userId === ticketUserId);
      if (ticket?.kudos.some((k) => k.fromUserId === fromUserId)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// An unbounded wait would hang this test's own cleanup forever if the server
// never sent the event being waited for at all — same reasoning as every
// other rewritten file in this suite.
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

const mode = "silent";

// room:stamp-ticket is still a break-only ritual for an ordinary full-block
// ticket — src/rooms.ts checks state.status === "break" (with a narrow
// personal-duration carve-out tested separately in early-finish-stamp.test.ts)
// before it even looks at the stamp value a caller sent. room:send-kudos is
// no longer gated to break at all (see the acceptance test below) — kudos is
// a lightweight predefined reaction, not a break-only ritual.
it(
  "rejects room:stamp-ticket while the table is still in focus and no personal-duration block has elapsed",
  async () => {
    const slug = "law-l3";
    const cookie = await registerAndGetCookie(`notbreak-${randomUUID().slice(0, 8)}`);

    const socket = connect(cookie);
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "socket to see focus status");

      const stampRejection = once<RoomError>(socket, "room:error");
      socket.emit("room:stamp-ticket", { stamp: "completed" });
      const stampPayload = await withTimeout(stampRejection, 5000, "room:error for stamp-ticket during focus");
      expect(stampPayload).toEqual({ error: "not_breaking", action: "room:stamp-ticket" });
    } finally {
      socket.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);

// The gate room:send-kudos actually enforces post-fix: not_breaking only ever
// fires for a bad phase (idle) or a malformed emoji, never for "it's focus,
// not break" — this proves a normal full-block focus cycle accepts a kudos
// the moment both tickets are boarded, without waiting for break at all.
it(
  "accepts room:send-kudos while the table is still in focus",
  async () => {
    const slug = "chifley-lg";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`kudos-focus-a-${uid}`);
    const bCookie = await registerAndGetCookie(`kudos-focus-b-${uid}`);
    const { id: bId } = await getMe(bCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    try {
      await Promise.all([once(a, "connect"), once(b, "connect")]);
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      await once(a, "room:update");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");
      await once(b, "room:update");

      const aFocus = untilStatus(a, "focus");
      const bFocus = untilStatus(b, "focus");
      a.emit("room:submit-ticket", { body: "Draft intro" });
      b.emit("room:submit-ticket", { body: "Outline conclusion" });
      await withTimeout(aFocus, TABLE_CYCLE_MS + 10000, "A to see focus status");
      await withTimeout(bFocus, TABLE_CYCLE_MS + 10000, "B to see focus update");

      const bSeesKudos = untilKudosFrom(b, bId, (await getMe(aCookie)).id);
      a.emit("room:send-kudos", { toUserId: bId, emoji: "☕" });
      const kudosPayload = await withTimeout(bSeesKudos, 5000, "B to see A's kudos land during focus");
      const bTicket = kudosPayload.tickets.find((t) => t.userId === bId);
      expect(bTicket?.kudos.length).toBe(1);
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);

// The four rejection/acceptance paths room:send-kudos can take once a table
// *is* on break, all tied to the same pair of boarded tickets: you can't
// kudos yourself, you can't kudos someone with no ticket this cycle, a
// genuine kudos lands and is visible to the whole table, and sending a
// second one to the same recipient is a no-op rejection rather than stacking
// (kudos's UNIQUE(ticket_id, from_user_id) constraint — see addKudos).
it(
  "enforces self-kudos, not_found, and already_given rejections, and accepts a valid kudos",
  async () => {
    const slug = "marie-reay-l2";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`kudos-a-${uid}`);
    const bCookie = await registerAndGetCookie(`kudos-b-${uid}`);
    const cCookie = await registerAndGetCookie(`kudos-c-${uid}`);
    const { id: aId } = await getMe(aCookie);
    const { id: bId } = await getMe(bCookie);
    const { id: cId } = await getMe(cCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    // This test holds both sockets connected through a full focus block into
    // break — long enough for the server's own check-in pings to reach them
    // (see tab-telemetry.test.ts). Answering them honestly keeps this test
    // about kudos rejection/acceptance, not about the unrelated check-in
    // demotion path (which has its own dedicated tests).
    a.on("room:checkin-request", () => a.emit("room:checkin-confirm"));
    b.on("room:checkin-request", () => b.emit("room:checkin-confirm"));
    try {
      await Promise.all([once(a, "connect"), once(b, "connect")]);
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      await once(a, "room:update");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");
      await once(b, "room:update");

      const aFocus = untilStatus(a, "focus");
      const bFocus = untilStatus(b, "focus");
      a.emit("room:submit-ticket", { body: "Draft intro" });
      b.emit("room:submit-ticket", { body: "Outline conclusion" });
      await withTimeout(aFocus, TABLE_CYCLE_MS + 10000, "A to see focus status");
      await withTimeout(bFocus, TABLE_CYCLE_MS + 10000, "B to see focus update");

      const aBreak = untilStatus(a, "break");
      const bBreak = untilStatus(b, "break");
      await withTimeout(aBreak, TABLE_CYCLE_MS + 10000, "A to see break status");
      await withTimeout(bBreak, TABLE_CYCLE_MS + 10000, "B to see break update");

      // C never boarded this cycle — no ticket for A to find.
      const selfRejection = once<RoomError>(a, "room:error");
      a.emit("room:send-kudos", { toUserId: aId, emoji: "⚡" });
      const selfPayload = await withTimeout(selfRejection, 5000, "room:error for self-kudos");
      expect(selfPayload).toEqual({ error: "self_kudos", action: "room:send-kudos" });

      const notFoundRejection = once<RoomError>(a, "room:error");
      a.emit("room:send-kudos", { toUserId: cId, emoji: "⚡" });
      const notFoundPayload = await withTimeout(notFoundRejection, 5000, "room:error for kudos to a non-boarded user");
      expect(notFoundPayload).toEqual({ error: "not_found", action: "room:send-kudos" });

      const bSeesKudos = untilKudosFrom(b, bId, aId);
      a.emit("room:send-kudos", { toUserId: bId, emoji: "☕" });
      const kudosPayload = await withTimeout(bSeesKudos, 5000, "B to see A's kudos land on their ticket");
      const bTicket = kudosPayload.tickets.find((t) => t.userId === bId);
      expect(bTicket?.kudos).toEqual([expect.objectContaining({ fromUserId: aId, emoji: "☕" })]);

      const dupeRejection = once<RoomError>(a, "room:error");
      a.emit("room:send-kudos", { toUserId: bId, emoji: "🧠" });
      const dupePayload = await withTimeout(dupeRejection, 5000, "room:error for a second kudos to the same recipient");
      expect(dupePayload).toEqual({ error: "already_given", action: "room:send-kudos" });
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// Ties together two mechanisms that only make sense in combination: the
// check-in penalty demotion path (markTicketNotFullBlock, src/rooms.ts's
// applyCheckinPenalty) and VFH's requirement of *both* stayed_full_block=1
// and a non-null stamp (getVfhCount). A demoted socket itself loses write
// access (see tab-telemetry.test.ts), but nothing stops the same person from
// opening a fresh connection and re-joining the same table before the cycle
// rolls over — that second, non-demoted socket *can* stamp the very ticket
// the first one left behind. This proves that stamping afterward still isn't
// enough: the ticket's stayed_full_block was already permanently flipped to 0
// the moment the penalty fired, so the stamp alone can't resurrect the VFH.
it(
  "withholds VFH from a ticket holder demoted mid-focus, even if a reconnection stamps it during break",
  async () => {
    const slug = "menzies-l1";
    const username = `demoted-vfh-${randomUUID().slice(0, 8)}`;
    const password = "password123";
    const cookie = await registerAndGetCookie(username);

    const first = connect(cookie);
    try {
      await once(first, "connect");
      first.emit("room:join", { slug, mode });
      await once(first, "room:joined");
      await once(first, "room:update");

      const sawFocus = untilStatus(first, "focus");
      first.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "first socket to see focus status");

      const residentGone = new Promise<void>((resolve) => {
        const handler = (payload: { roster: RosterEntry[] }): void => {
          if (!payload.roster.some((r) => r.username === username)) {
            first.off("room:update", handler);
            resolve();
          }
        };
        first.on("room:update", handler);
      });
      // No tab_hidden event exists anymore (micro check-ins replace
      // tab-visibility tracking) — never confirming a check-in ping leaves
      // the grace timeout to demote on its own. Really wait out the server's
      // own timer rather than faking it, same no-fake-timers convention as
      // tab-telemetry.test.ts. This only proves what it means to prove if the
      // demotion fires while the table is still mid-focus — CI (and this
      // file's own local verification) sets CHECKIN_GRACE_MS comfortably
      // shorter than the focus block for exactly this reason; see
      // checks.yml's comment.
      await withTimeout(residentGone, CHECKIN_GRACE_MS + TABLE_CYCLE_MS + 10000, "roster to drop the demoted user");
    } finally {
      first.close();
    }

    // A fresh connection is a fresh Presence entry (demoted: false) — this is
    // the same person, reconnecting before this cycle's break ends, not a
    // loophole: the server tracks demotion per-socket by design (see
    // src/rooms.ts's isDemoted comment), since nothing else could ever let an
    // honestly-reconnected tab regain write access at all.
    const second = connect(cookie);
    try {
      await once(second, "connect");
      second.emit("room:join", { slug, mode });
      await once(second, "room:joined");
      const toBreak = untilStatus(second, "break");
      await withTimeout(toBreak, TABLE_CYCLE_MS + 10000, "second socket to see break status");

      const { id: userId } = await getMe(cookie);
      const stamped = new Promise<void>((resolve) => {
        const handler = (payload: RoomUpdate): void => {
          if (payload.tickets.some((t) => t.userId === userId && t.stamp === "completed")) {
            second.off("room:update", handler);
            resolve();
          }
        };
        second.on("room:update", handler);
      });
      second.emit("room:stamp-ticket", { stamp: "completed" });
      await withTimeout(stamped, 5000, "the reconnected socket's stamp to land");
    } finally {
      second.close();
    }

    const returnCookie = await loginAndGetCookie(username, password);
    const me = await getMe(returnCookie);
    expect(me.vfhCount).toBe(0);
  },
  TABLE_CYCLE_MS * 2 + CHECKIN_GRACE_MS + 30000,
);
