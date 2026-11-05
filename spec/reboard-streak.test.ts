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

type StreakEntry = { locationName: string; activityMode: string; currentStreak: number; longestStreak: number };

// listStreaksForUser (src/db.ts) only surfaces rows with current_streak > 0 —
// a user whose streak was just reset to 0 produces no row at all, not a row
// reading 0. Every assertion below that checks for a reset relies on this:
// it asserts absence from the array, never a zero value.
async function getStreaks(cookie: string): Promise<StreakEntry[]> {
  const res = await fetch(new URL("/api/me/streaks", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { streaks: StreakEntry[] };
  return body.streaks;
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type Ticket = { userId: number };
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

// Rolling over to the next cycle is a purely individual choice now, not a
// group vote (no room:cast-vote / room:initiate-vote exist anymore — see
// modes-description.md): the only thing room:submit-ticket's streak logic
// looks at is this one user's own most recent prior ticket at this table.
// Completing it and coming back increments current_streak; nothing about a
// table-mate's behavior enters into it.
it(
  "increments current_streak when a user reboards after completing their previous ticket, independent of anyone else at the table",
  async () => {
    // kambri-l1 is already claimed by lobby-override-race.test.ts, but only
    // on "silent" — tables key by (location, mode), so "writing" here is a
    // disjoint, collision-free pairing on the same slug.
    const slug = "kambri-l1";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`streak-win-a-${uid}`);
    const bCookie = await registerAndGetCookie(`streak-win-b-${uid}`);

    const a = connect(aCookie);
    const b = connect(bCookie);
    // Both sockets stay connected across multiple cycles' focus blocks, long
    // enough for the server's own check-in pings to reach them (see
    // tab-telemetry.test.ts) — answering honestly keeps this test about
    // reboard streaks, not the unrelated check-in demotion path.
    a.on("room:checkin-request", () => a.emit("room:checkin-confirm"));
    b.on("room:checkin-request", () => b.emit("room:checkin-confirm"));
    try {
      await Promise.all([once(a, "connect"), once(b, "connect")]);
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");

      const cycle1Boarded = untilTicketCount(a, 2);
      a.emit("room:submit-ticket", { body: "Draft intro" });
      b.emit("room:submit-ticket", { body: "Draft outline" });
      await withTimeout(cycle1Boarded, 10000, "a to see both boarded tickets for cycle 1");

      const aFocus1 = untilStatus(a, "focus");
      const bFocus1 = untilStatus(b, "focus");
      await withTimeout(aFocus1, TABLE_CYCLE_MS + 10000, "a to see focus status in cycle 1");
      await withTimeout(bFocus1, TABLE_CYCLE_MS + 10000, "b to see focus update in cycle 1");

      const aBreak1 = untilStatus(a, "break");
      const bBreak1 = untilStatus(b, "break");
      await withTimeout(aBreak1, TABLE_CYCLE_MS + 10000, "a to see break status in cycle 1");
      await withTimeout(bBreak1, TABLE_CYCLE_MS + 10000, "b to see break update in cycle 1");

      // a stamps "completed"; b doesn't stamp at all (stamp stays null) — the
      // streak logic only cares what a's own previous ticket looked like.
      a.emit("room:stamp-ticket", { stamp: "completed" });

      const aIdle1 = untilStatus(a, "idle");
      const bIdle1 = untilStatus(b, "idle");
      await withTimeout(aIdle1, TABLE_CYCLE_MS + 10000, "a to see cycle 1 resolve back to idle");
      await withTimeout(bIdle1, TABLE_CYCLE_MS + 10000, "b to see cycle 1 resolve back to idle");

      // Neither has reboarded yet, so no streak row should exist for either.
      expect(await getStreaks(aCookie)).toEqual([]);
      expect(await getStreaks(bCookie)).toEqual([]);

      // Cycle 2: only a reboards. b sits this cycle out entirely — proving
      // a's streak increment has nothing to do with what b does or doesn't
      // do (there is no quorum, no group action of any kind).
      const aReboarded = untilTicketCount(a, 1);
      a.emit("room:submit-ticket", { body: "Draft revision" });
      await withTimeout(aReboarded, 10000, "a to see its reboarded ticket for cycle 2");

      const afterReboardA = await getStreaks(aCookie);
      expect(afterReboardA).toEqual([expect.objectContaining({ activityMode: mode, currentStreak: 1 })]);
      expect(await getStreaks(bCookie)).toEqual([]);
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// The mirror case: reboarding after a ticket that was only "partial" (or
// never stamped at all) resets the streak to 0, with nobody else's action
// involved — same individual-only posture as the increment path above.
it(
  "resets current_streak to 0 when a user reboards after their previous ticket was only partial",
  async () => {
    // kambri-l2 is already claimed by reconnect-sync.test.ts, but only on
    // "silent" — "writing" here is a disjoint, collision-free pairing.
    const slug = "kambri-l2";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`streak-reset-a-${uid}`);

    const a = connect(aCookie);
    // Stays connected across three cycles' focus blocks, long enough for the
    // server's own check-in pings to reach it (see tab-telemetry.test.ts) —
    // answering honestly keeps this test about reboard streaks, not the
    // unrelated check-in demotion path.
    a.on("room:checkin-request", () => a.emit("room:checkin-confirm"));
    try {
      await once(a, "connect");
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");

      // --- Cycle 1: board, complete, reboard — builds a streak of 1. ---
      const cycle1Boarded = untilTicketCount(a, 1);
      a.emit("room:submit-ticket", { body: "Draft intro" });
      await withTimeout(cycle1Boarded, 10000, "a to see cycle 1 boarded ticket");

      const focus1 = untilStatus(a, "focus");
      await withTimeout(focus1, TABLE_CYCLE_MS + 10000, "a to see focus status in cycle 1");

      const break1 = untilStatus(a, "break");
      await withTimeout(break1, TABLE_CYCLE_MS + 10000, "a to see break status in cycle 1");

      a.emit("room:stamp-ticket", { stamp: "completed" });

      const idle1 = untilStatus(a, "idle");
      await withTimeout(idle1, TABLE_CYCLE_MS + 10000, "a to see cycle 1 resolve back to idle");

      const cycle2Boarded = untilTicketCount(a, 1);
      a.emit("room:submit-ticket", { body: "Draft revision" });
      await withTimeout(cycle2Boarded, 10000, "a to see cycle 2 boarded ticket");
      expect(await getStreaks(aCookie)).toEqual([expect.objectContaining({ activityMode: mode, currentStreak: 1 })]);

      // --- Cycle 2: this time only stamp "partial", then reboard — streak
      // must reset to 0 (i.e. disappear from listStreaksForUser). ---
      const focus2 = untilStatus(a, "focus");
      await withTimeout(focus2, TABLE_CYCLE_MS + 10000, "a to see focus status in cycle 2");

      const break2 = untilStatus(a, "break");
      await withTimeout(break2, TABLE_CYCLE_MS + 10000, "a to see break status in cycle 2");

      a.emit("room:stamp-ticket", { stamp: "partial" });

      const idle2 = untilStatus(a, "idle");
      await withTimeout(idle2, TABLE_CYCLE_MS + 10000, "a to see cycle 2 resolve back to idle");

      const cycle3Boarded = untilTicketCount(a, 1);
      a.emit("room:submit-ticket", { body: "Draft again" });
      await withTimeout(cycle3Boarded, 10000, "a to see cycle 3 boarded ticket");

      expect(await getStreaks(aCookie)).toEqual([]);
    } finally {
      a.close();
    }
  },
  TABLE_CYCLE_MS * 3 + 40000,
);
