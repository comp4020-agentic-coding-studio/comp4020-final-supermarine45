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

async function getMe(cookie: string): Promise<{ id: number; vfhCount: number | null }> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

type StreakEntry = { locationName: string; activityMode: string; currentStreak: number; longestStreak: number };

// listStreaksForUser (src/db.ts) only surfaces rows with current_streak > 0 —
// see reboard-streak.test.ts's own copy of this comment for the full
// rationale. Reused here to prove a "pivoted" stamp preserves the streak the
// same way "completed" does.
async function getStreaks(cookie: string): Promise<StreakEntry[]> {
  const res = await fetch(new URL("/api/me/streaks", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { streaks: StreakEntry[] };
  return body.streaks;
}

function connect(cookie?: string): Socket {
  return io(baseUrl, { extraHeaders: cookie ? { cookie } : {}, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type Ticket = { userId: number; body: string; stamp: string | null; pivotedAt: number | null };
type RoomUpdate = { timer: { status: string }; tickets: Ticket[] };
type RoomError = { error: string; action: string };

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
      const ticket = payload.tickets.find((t) => t.userId === userId);
      if (ticket?.body === body) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

function untilTicketStamp(socket: Socket, userId: number, stamp: string): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      const ticket = payload.tickets.find((t) => t.userId === userId);
      if (ticket?.stamp === stamp) {
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

// Pivot Goal is mode-agnostic (gated only on timer.status === "focus" and an
// existing ticket), unlike Peer Review/Whiteboard which are mode-locked —
// so this quick negative test doesn't need wrong_mode, it needs the shadow
// (unauthenticated) path instead, and that check fires before any table
// state is even looked at, so no cycle wait is needed. Uses "menzies"/"pitch"
// — a distinct (location, mode) pairing from the main test below on the same
// slug ("menzies"/"silent"), per the suite's own joint-key convention.
it("rejects room:pivot-ticket from an unauthenticated (shadow) socket with unauthorized", async () => {
  const slug = "menzies";
  const mode = "pitch";

  const shadow = connect();
  try {
    await once(shadow, "connect");
    shadow.emit("room:join", { slug, mode });
    const joined = await once<{ isShadow: boolean }>(shadow, "room:joined");
    expect(joined.isShadow).toBe(true);

    const rejection = once<RoomError>(shadow, "room:error");
    shadow.emit("room:pivot-ticket", { body: "A brand new goal" });
    const payload = await withTimeout(rejection, 5000, "room:error for pivot-ticket from a shadow socket");
    expect(payload).toEqual({ error: "unauthorized", action: "room:pivot-ticket" });
  } finally {
    shadow.close();
  }
});

// "menzies" (the bare legacy slug, distinct from "menzies-ground" and
// similar) has zero other uses anywhere in spec/ (confirmed by grep), so this
// table is wholly owned by this test file across both its test cases.
it(
  "pivots a ticket mid-focus with a live-replicated body change, gates the Pivoted stamp on having actually pivoted, and grants VFH + preserves the reboard streak same as Completed",
  async () => {
    const slug = "menzies";
    const mode = "silent";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`pivot-a-${uid}`);
    const bCookie = await registerAndGetCookie(`pivot-b-${uid}`);
    const aId = await getUserId(aCookie);
    const bId = await getUserId(bCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    a.on("room:checkin-request", () => a.emit("room:checkin-confirm"));
    b.on("room:checkin-request", () => b.emit("room:checkin-confirm"));
    try {
      await Promise.all([once(a, "connect"), once(b, "connect")]);
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");

      const bothBoarded = untilTicketCount(a, 2);
      a.emit("room:submit-ticket", { body: "Read the first two chapters" });
      b.emit("room:submit-ticket", { body: "Read the appendix" });
      await withTimeout(bothBoarded, 10000, "a to see both boarded tickets");

      await Promise.all([
        withTimeout(untilStatus(a, "focus"), TABLE_CYCLE_MS + 10000, "a to see focus status"),
        withTimeout(untilStatus(b, "focus"), TABLE_CYCLE_MS + 10000, "b to see focus status"),
      ]);

      // A third socket joins mid-focus without ever boarding a ticket — a
      // pivot attempt with no existing ticket is rejected no_ticket, not
      // treated as an implicit board.
      const cCookie = await registerAndGetCookie(`pivot-c-${uid}`);
      const c = connect(cCookie);
      c.on("room:checkin-request", () => c.emit("room:checkin-confirm"));
      try {
        await once(c, "connect");
        c.emit("room:join", { slug, mode });
        await once(c, "room:joined");

        const noTicketRejection = once<RoomError>(c, "room:error");
        c.emit("room:pivot-ticket", { body: "A goal I never boarded" });
        const noTicketPayload = await withTimeout(noTicketRejection, 5000, "room:error for pivoting with no existing ticket");
        expect(noTicketPayload).toEqual({ error: "no_ticket", action: "room:pivot-ticket" });
      } finally {
        c.close();
      }

      // ticketBodyError (shared with room:submit-ticket) rejects a body with
      // fewer than 3 non-space characters.
      const invalidRejection = once<RoomError>(a, "room:error");
      a.emit("room:pivot-ticket", { body: "ab" });
      const invalidPayload = await withTimeout(invalidRejection, 5000, "room:error for pivoting with an invalid body");
      expect(invalidPayload).toEqual({ error: "invalid_ticket", action: "room:pivot-ticket" });

      // The actual pivot: a's body changes and pivotedAt becomes non-null,
      // and the change reaches b's own screen too (the Live Replicated
      // Effect every connected client sees, not just the pivoting user).
      const newBody = "Pivoted: outline a new essay instead";
      const aSeesPivot = untilTicketBody(a, aId, newBody);
      const bSeesPivot = untilTicketBody(b, aId, newBody);
      a.emit("room:pivot-ticket", { body: newBody });
      const [aPivotPayload, bPivotPayload] = await withTimeout(
        Promise.all([aSeesPivot, bSeesPivot]),
        5000,
        "both sockets to see a's pivoted ticket body",
      );
      const aTicketForA = aPivotPayload.tickets.find((t) => t.userId === aId)!;
      const bTicketForA = bPivotPayload.tickets.find((t) => t.userId === aId)!;
      expect(aTicketForA.pivotedAt).not.toBeNull();
      expect(bTicketForA.pivotedAt).not.toBeNull();

      await Promise.all([
        withTimeout(untilStatus(a, "break"), TABLE_CYCLE_MS + 10000, "a to see break status"),
        withTimeout(untilStatus(b, "break"), TABLE_CYCLE_MS + 10000, "b to see break status"),
      ]);

      // Pivoting is only legal mid-focus — attempting it again now that the
      // table is on break is rejected not_focusing, even though a's ticket
      // still exists.
      const notFocusingRejection = once<RoomError>(a, "room:error");
      a.emit("room:pivot-ticket", { body: "Trying to pivot during the break" });
      const notFocusingPayload = await withTimeout(notFocusingRejection, 5000, "room:error for pivoting outside focus");
      expect(notFocusingPayload).toEqual({ error: "not_focusing", action: "room:pivot-ticket" });

      // b's ticket was never pivoted, so the Pivoted stamp is refused for it
      // — this is the server-side half of the Break Modal only ever
      // offering that button for a ticket that was actually pivoted.
      const notPivotedRejection = once<RoomError>(b, "room:error");
      b.emit("room:stamp-ticket", { stamp: "pivoted" });
      const notPivotedPayload = await withTimeout(notPivotedRejection, 5000, "room:error for stamping Pivoted on a never-pivoted ticket");
      expect(notPivotedPayload).toEqual({ error: "not_pivoted", action: "room:stamp-ticket" });

      // a's ticket *was* pivoted, so the same stamp succeeds for a.
      const aStamped = untilTicketStamp(a, aId, "pivoted");
      a.emit("room:stamp-ticket", { stamp: "pivoted" });
      await withTimeout(aStamped, 5000, "a's ticket to be stamped pivoted");

      // Pivoted counts toward VFH exactly like Completed (locked-in
      // decision) — getVfhCount's predicate is just "stamp IS NOT NULL AND
      // stayed_full_block = 1", which a pivoted-and-stamped ticket satisfies.
      const me = await getMe(aCookie);
      expect(me.vfhCount).toBe(1);

      await Promise.all([
        withTimeout(untilStatus(a, "idle"), TABLE_CYCLE_MS + 10000, "a to see cycle resolve back to idle"),
        withTimeout(untilStatus(b, "idle"), TABLE_CYCLE_MS + 10000, "b to see cycle resolve back to idle"),
      ]);

      // No reboard yet, so no streak row should exist.
      expect(await getStreaks(aCookie)).toEqual([]);

      // Reboarding after a "pivoted" stamp preserves/increments the streak
      // the same way reboarding after "completed" does (reboard-streak.test.ts
      // proves the "completed" half of this same contract).
      const aReboarded = untilTicketCount(a, 1);
      a.emit("room:submit-ticket", { body: "Draft the new essay's outline" });
      await withTimeout(aReboarded, 10000, "a to see its reboarded ticket");

      const streaksAfterReboard = await getStreaks(aCookie);
      expect(streaksAfterReboard).toEqual([expect.objectContaining({ activityMode: mode, currentStreak: 1 })]);
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 40000,
);
