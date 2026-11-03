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

type Ticket = { userId: number; vote: "yes" | "no" | null };
type RoomUpdate = {
  timer: { status: string };
  tickets: Ticket[];
  leaderUserId: number | null;
  voteOpenedAt: number | null;
};
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

function untilVoteRecorded(socket: Socket, userId: number, vote: "yes" | "no"): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      const mine = payload.tickets.find((t) => t.userId === userId);
      if (mine && mine.vote === vote) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

function untilVoteOpened(socket: Socket): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.voteOpenedAt !== null) {
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

// room:cast-vote only means anything once a table has something to vote on
// rolling over or not — src/rooms.ts checks state.status === "break" before
// it even looks at the vote value sent.
it(
  "rejects room:cast-vote with not_breaking while the table is still in focus",
  async () => {
    const slug = "kambri-l1";
    const mode = "writing";
    const cookie = await registerAndGetCookie(`vote-notbreak-${randomUUID().slice(0, 8)}`);

    const socket = connect(cookie);
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "Draft section two" });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "socket to see focus status");

      const rejection = once<RoomError>(socket, "room:error");
      socket.emit("room:cast-vote", { vote: "yes" });
      const payload = await withTimeout(rejection, 5000, "room:error for cast-vote during focus");
      expect(payload).toEqual({ error: "not_breaking", action: "room:cast-vote" });
    } finally {
      socket.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);

// room:initiate-vote is Leader-gated (same posture as room:launch-whiteboard)
// — any other boarded member is rejected outright, while the Leader's own
// call opens voting for the whole table (visible to everyone via
// voteOpenedAt), even though room:cast-vote itself never actually requires
// voting to have been "opened" first (Decision 4: no hard gate on voting
// itself, only on who can raise the flag that invites it).
it(
  "rejects a non-leader's room:initiate-vote with not_leader, and the leader's succeeds and broadcasts voteOpenedAt",
  async () => {
    const slug = "chifley-l3";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`vote-leader-a-${uid}`);
    const bCookie = await registerAndGetCookie(`vote-leader-b-${uid}`);
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
      a.emit("room:submit-ticket", { body: "Draft intro" });
      b.emit("room:submit-ticket", { body: "Draft outline" });
      const [aBoth] = await Promise.all([
        withTimeout(aSeesBoth, 10000, "a to see both boarded tickets"),
        withTimeout(bSeesBoth, 10000, "b to see both boarded tickets"),
      ]);
      const leaderUserId = aBoth.leaderUserId!;
      expect([aId, bId]).toContain(leaderUserId);
      const leaderSocket = leaderUserId === aId ? a : b;
      const nonLeaderSocket = leaderUserId === aId ? b : a;

      const aFocus = untilStatus(a, "focus");
      const bFocus = untilStatus(b, "focus");
      await withTimeout(aFocus, TABLE_CYCLE_MS + 10000, "a to see focus status");
      await withTimeout(bFocus, TABLE_CYCLE_MS + 10000, "b to see focus update");

      const aBreak = untilStatus(a, "break");
      const bBreak = untilStatus(b, "break");
      await withTimeout(aBreak, TABLE_CYCLE_MS + 10000, "a to see break status");
      await withTimeout(bBreak, TABLE_CYCLE_MS + 10000, "b to see break update");

      const rejection = once<RoomError>(nonLeaderSocket, "room:error");
      nonLeaderSocket.emit("room:initiate-vote");
      const rejectionPayload = await withTimeout(rejection, 5000, "room:error for a non-leader's initiate-vote");
      expect(rejectionPayload).toEqual({ error: "not_leader", action: "room:initiate-vote" });

      const bothSeeOpen = Promise.all([untilVoteOpened(a), untilVoteOpened(b)]);
      leaderSocket.emit("room:initiate-vote");
      const [openedA, openedB] = await withTimeout(bothSeeOpen, 5000, "both sockets to see voteOpenedAt set");
      expect(openedA.voteOpenedAt).not.toBeNull();
      expect(openedB.voteOpenedAt).toBe(openedA.voteOpenedAt);
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// Quorum rule (src/rooms.ts's resolveVotesAndStreaks): at least half of the
// cycle's boarded tickets must have cast a vote at all. With 3 boarded and
// only 1 vote cast, 1 < ceil(3/2)=2, so the vote never passes regardless of
// what that lone vote was — not even a streak for the person who voted yes.
it(
  "does not pass a vote (or award a streak) when only 1 of 3 boarded tickets voted, even though that vote was yes",
  async () => {
    const slug = "marie-reay-l2";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`vote-quorum-a-${uid}`);
    const bCookie = await registerAndGetCookie(`vote-quorum-b-${uid}`);
    const cCookie = await registerAndGetCookie(`vote-quorum-c-${uid}`);
    const aId = await getUserId(aCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    const c = connect(cCookie);
    try {
      await Promise.all([once(a, "connect"), once(b, "connect"), once(c, "connect")]);
      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");
      c.emit("room:join", { slug, mode });
      await once(c, "room:joined");

      const allBoarded = untilTicketCount(a, 3);
      a.emit("room:submit-ticket", { body: "Draft intro" });
      b.emit("room:submit-ticket", { body: "Draft body" });
      c.emit("room:submit-ticket", { body: "Draft conclusion" });
      await withTimeout(allBoarded, 10000, "a to see all 3 boarded tickets");

      const aFocus = untilStatus(a, "focus");
      await withTimeout(aFocus, TABLE_CYCLE_MS + 10000, "a to see focus status");

      const aBreak = untilStatus(a, "break");
      await withTimeout(aBreak, TABLE_CYCLE_MS + 10000, "a to see break status");

      const aVoted = untilVoteRecorded(a, aId, "yes");
      a.emit("room:cast-vote", { vote: "yes" });
      await withTimeout(aVoted, 5000, "a's yes vote to be recorded");

      const aIdle = untilStatus(a, "idle");
      await withTimeout(aIdle, TABLE_CYCLE_MS + 10000, "a to see the cycle resolve back to idle");

      const streaks = await getStreaks(aCookie);
      expect(streaks).toEqual([]);
    } finally {
      a.close();
      b.close();
      c.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// The full rollover arc across two consecutive cycles at the same table: a
// unanimous yes with quorum met increments current_streak for both voters,
// then a contested second cycle (one yes, one no — quorum met but yes>no
// fails) resets *everyone*, including the user who voted yes. That last part
// is easy to miss from the plan's prose alone ("resetting no-voters/non-
// voters to 0") but is exactly what resolveVotesAndStreaks does: the
// increment only ever fires when the group's vote passed as a whole, so one
// dissenting vote costs the whole table its streak, not just the dissenter.
it(
  "increments current_streak for a unanimous passing vote, then resets everyone (yes-voter included) after a contested failing vote",
  async () => {
    const slug = "hancock-l3";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`vote-streak-a-${uid}`);
    const bCookie = await registerAndGetCookie(`vote-streak-b-${uid}`);
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

      // --- Cycle 1: both vote yes, quorum met (2 of 2), vote passes. ---
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

      const aVotedYes1 = untilVoteRecorded(a, aId, "yes");
      const bVotedYes1 = untilVoteRecorded(a, bId, "yes");
      a.emit("room:cast-vote", { vote: "yes" });
      b.emit("room:cast-vote", { vote: "yes" });
      await withTimeout(Promise.all([aVotedYes1, bVotedYes1]), 5000, "both votes to be recorded in cycle 1");

      const aIdle1 = untilStatus(a, "idle");
      const bIdle1 = untilStatus(b, "idle");
      await withTimeout(aIdle1, TABLE_CYCLE_MS + 10000, "a to see cycle 1 resolve back to idle");
      await withTimeout(bIdle1, TABLE_CYCLE_MS + 10000, "b to see cycle 1 resolve back to idle");

      const afterCycle1A = await getStreaks(aCookie);
      const afterCycle1B = await getStreaks(bCookie);
      expect(afterCycle1A).toEqual([expect.objectContaining({ activityMode: mode, currentStreak: 1 })]);
      expect(afterCycle1B).toEqual([expect.objectContaining({ activityMode: mode, currentStreak: 1 })]);

      // --- Cycle 2: same table, A votes yes, B votes no — quorum met (2 of
      // 2) but yes (1) does not outnumber no (1), so the vote fails and both
      // reset, A included. ---
      const cycle2Boarded = untilTicketCount(a, 2);
      a.emit("room:submit-ticket", { body: "Draft revision" });
      b.emit("room:submit-ticket", { body: "Draft feedback" });
      await withTimeout(cycle2Boarded, 10000, "a to see both boarded tickets for cycle 2");

      const aFocus2 = untilStatus(a, "focus");
      const bFocus2 = untilStatus(b, "focus");
      await withTimeout(aFocus2, TABLE_CYCLE_MS + 10000, "a to see focus status in cycle 2");
      await withTimeout(bFocus2, TABLE_CYCLE_MS + 10000, "b to see focus update in cycle 2");

      const aBreak2 = untilStatus(a, "break");
      const bBreak2 = untilStatus(b, "break");
      await withTimeout(aBreak2, TABLE_CYCLE_MS + 10000, "a to see break status in cycle 2");
      await withTimeout(bBreak2, TABLE_CYCLE_MS + 10000, "b to see break update in cycle 2");

      const aVotedYes2 = untilVoteRecorded(a, aId, "yes");
      const bVotedNo2 = untilVoteRecorded(a, bId, "no");
      a.emit("room:cast-vote", { vote: "yes" });
      b.emit("room:cast-vote", { vote: "no" });
      await withTimeout(Promise.all([aVotedYes2, bVotedNo2]), 5000, "both votes to be recorded in cycle 2");

      const aIdle2 = untilStatus(a, "idle");
      const bIdle2 = untilStatus(b, "idle");
      await withTimeout(aIdle2, TABLE_CYCLE_MS + 10000, "a to see cycle 2 resolve back to idle");
      await withTimeout(bIdle2, TABLE_CYCLE_MS + 10000, "b to see cycle 2 resolve back to idle");

      const afterCycle2A = await getStreaks(aCookie);
      const afterCycle2B = await getStreaks(bCookie);
      expect(afterCycle2A).toEqual([]);
      expect(afterCycle2B).toEqual([]);
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 4 + 40000,
);
