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

async function getUserId(cookie: string): Promise<number> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: number };
  return body.id;
}

function connect(cookie?: string): Socket {
  return io(baseUrl, { extraHeaders: cookie ? { cookie } : {}, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type TicketComment = { id: number; ticketId: number; fromUserId: number; fromUsername: string; body: string; createdAt: number };
type Ticket = { userId: number; username: string; comments: TicketComment[] };
type RoomUpdate = {
  timer: { status: string; subphase: string | null };
  tickets: Ticket[];
  peerReviewOpenedAt: number | null;
  pitchOpenedAt: number | null;
};
type RoomError = { error: string; action: string };
type PeerReviewAssignment = { authorId: number; authorUsername: string; text: string };
type PitchAssignment = { pitcherId: number; pitcherUsername: string; text: string };

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

function untilSubphase(socket: Socket, subphase: string): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.timer.subphase === subphase) {
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

// Same reasoning as peer-review.test.ts's untilPeerReviewOpened: both portals
// auto-open at their mode's Collab split with no manual "Launch" step, so
// waiting for the *Opened flag itself (rather than inferring it from the
// subphase alone) is what room:submit-draft/room:submit-pitch themselves gate
// on.
function untilPeerReviewOpened(socket: Socket): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.peerReviewOpenedAt !== null) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

function untilPitchOpened(socket: Socket): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.pitchOpenedAt !== null) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// Comments ride the regular room:update broadcast (broadcastRoom), not a
// dedicated event — so "the owner sees their comment" means waiting for a
// room:update whose matching ticket's comments array satisfies `predicate`.
function untilTicketComment(
  socket: Socket,
  ownerUserId: number,
  predicate: (comments: TicketComment[]) => boolean,
): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      const ticket = payload.tickets.find((t) => t.userId === ownerUserId);
      if (ticket && predicate(ticket.comments)) {
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

// "menzies-l2" has "silent" claimed by tab-telemetry.test.ts — "writing" is
// untouched by any other spec file (confirmed by grep across spec/*.test.ts).
it(
  "lets an assigned Peer Review reviewer leave a comment that only the draft's author sees, rejects an unassigned commenter, and enforces the word limit",
  async () => {
    const slug = "menzies-l2";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`rc-a-${uid}`);
    const bCookie = await registerAndGetCookie(`rc-b-${uid}`);
    const cCookie = await registerAndGetCookie(`rc-c-${uid}`);
    const aId = await getUserId(aCookie);
    const bId = await getUserId(bCookie);
    const cId = await getUserId(cCookie);

    const draftText: Record<number, string> = {
      [aId]: "Draft A: the sea was angry that day, my friends.",
      [bId]: "Draft B: it was the best of times, it was the worst of times.",
      [cId]: "Draft C: call me Ishmael, some years ago.",
    };

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

      const aSeesThree = untilTicketCount(a, 3);
      const bSeesThree = untilTicketCount(b, 3);
      const cSeesThree = untilTicketCount(c, 3);
      a.emit("room:submit-ticket", { body: "Draft the introduction" });
      b.emit("room:submit-ticket", { body: "Draft the body paragraphs" });
      c.emit("room:submit-ticket", { body: "Draft the conclusion" });
      await Promise.all([
        withTimeout(aSeesThree, 10000, "a to see all three boarded tickets"),
        withTimeout(bSeesThree, 10000, "b to see all three boarded tickets"),
        withTimeout(cSeesThree, 10000, "c to see all three boarded tickets"),
      ]);

      await Promise.all([
        withTimeout(untilStatus(a, "focus"), TABLE_CYCLE_MS + 10000, "a to see focus status"),
        withTimeout(untilStatus(b, "focus"), TABLE_CYCLE_MS + 10000, "b to see focus status"),
        withTimeout(untilStatus(c, "focus"), TABLE_CYCLE_MS + 10000, "c to see focus status"),
      ]);

      await Promise.all([
        withTimeout(untilPeerReviewOpened(a), TABLE_CYCLE_MS + 10000, "a to see Peer Review open"),
        withTimeout(untilPeerReviewOpened(b), TABLE_CYCLE_MS + 10000, "b to see Peer Review open"),
        withTimeout(untilPeerReviewOpened(c), TABLE_CYCLE_MS + 10000, "c to see Peer Review open"),
      ]);

      // Same transient-2-way-then-settled-3-way reasoning as peer-review.test.ts:
      // b's submission already triggers a reciprocal assignment broadcast to a
      // and b before c ever joins the rotation, so that has to be drained
      // first or the listeners below could catch it instead of the settled
      // 3-way assignment.
      const aPrelim = once<PeerReviewAssignment>(a, "room:peer-review-assignment");
      const bPrelim = once<PeerReviewAssignment>(b, "room:peer-review-assignment");
      a.emit("room:submit-draft", { text: draftText[aId] });
      b.emit("room:submit-draft", { text: draftText[bId] });
      await withTimeout(Promise.all([aPrelim, bPrelim]), 10000, "a and b to see the transient 2-way assignment before c submits");

      const aAssigned = once<PeerReviewAssignment>(a, "room:peer-review-assignment");
      const bAssigned = once<PeerReviewAssignment>(b, "room:peer-review-assignment");
      const cAssigned = once<PeerReviewAssignment>(c, "room:peer-review-assignment");
      c.emit("room:submit-draft", { text: draftText[cId] });
      const [aAssignment, bAssignment, cAssignment] = await withTimeout(
        Promise.all([aAssigned, bAssigned, cAssigned]),
        10000,
        "all three sockets to receive their N-way rotation assignment",
      );

      const reviewers = [
        { socket: a, id: aId, assignment: aAssignment },
        { socket: b, id: bId, assignment: bAssignment },
        { socket: c, id: cId, assignment: cAssignment },
      ];
      const reviewerOfA = reviewers.find((r) => r.assignment.authorId === aId)!;
      const bystander = reviewers.find((r) => r.id !== aId && r.id !== reviewerOfA.id)!;

      // The assigned reviewer leaves a comment on a's draft. a sees it land
      // on their own ticket via the regular room:update broadcast...
      const aSeesComment = untilTicketComment(a, aId, (comments) => comments.length > 0);
      // ...while the bystander (boarded at the same table, but not a's
      // reviewer and not a themselves) must receive the *next* room:update
      // with a's ticket comments redacted to [] — proving this is a real
      // owner-only delivery, not just "the client UI happens to hide it".
      const bystanderNextUpdate = once<RoomUpdate>(bystander.socket, "room:update");
      const COMMENT = "Nice opening line — consider citing a source for the second claim.";
      reviewerOfA.socket.emit("room:submit-review-comment", { authorId: aId, body: COMMENT });

      const aPayload = await withTimeout(aSeesComment, 5000, "a to see the reviewer's comment on their own ticket");
      const aComment = aPayload.tickets.find((t) => t.userId === aId)!.comments[0];
      expect(aComment.body).toBe(COMMENT);
      expect(aComment.fromUserId).toBe(reviewerOfA.id);

      const bystanderPayload = await withTimeout(bystanderNextUpdate, 5000, "bystander to receive the redacted broadcast");
      const bystanderView = bystanderPayload.tickets.find((t) => t.userId === aId)!;
      expect(bystanderView.comments).toEqual([]);

      // The rotation assigned exactly one reviewer to a — the bystander
      // trying to comment on a's draft anyway must be rejected, proving the
      // server checks the actual assignment rather than "anyone boarded may
      // comment on anyone".
      const notAssignedRejection = once<RoomError>(bystander.socket, "room:error");
      bystander.socket.emit("room:submit-review-comment", { authorId: aId, body: "I wasn't assigned this one." });
      const notAssignedPayload = await withTimeout(notAssignedRejection, 5000, "room:error for commenting on a draft you weren't assigned to review");
      expect(notAssignedPayload).toEqual({ error: "not_assigned", action: "room:submit-review-comment" });

      // The same ≤100-word limit as every other comment box (commentTextError
      // in src/rooms.ts) applies here too.
      const tooLong = Array.from({ length: 101 }, (_, i) => `word${i}`).join(" ");
      const wordLimitRejection = once<RoomError>(reviewerOfA.socket, "room:error");
      reviewerOfA.socket.emit("room:submit-review-comment", { authorId: aId, body: tooLong });
      const wordLimitPayload = await withTimeout(wordLimitRejection, 5000, "room:error for a comment over the word limit");
      expect(wordLimitPayload).toEqual({ error: "invalid_comment", action: "room:submit-review-comment" });
    } finally {
      a.close();
      b.close();
      c.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// "kambri-l1" has "silent" and "writing" claimed elsewhere — "pitch" is free.
it(
  "lets an assigned Concept Pitch listener leave a comment that only the pitcher sees, and rejects an unassigned commenter",
  async () => {
    const slug = "kambri-l1";
    const mode = "pitch";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`pc-a-${uid}`);
    const bCookie = await registerAndGetCookie(`pc-b-${uid}`);
    const cCookie = await registerAndGetCookie(`pc-c-${uid}`);
    const aId = await getUserId(aCookie);
    const bId = await getUserId(bCookie);
    const cId = await getUserId(cCookie);

    const pitchText: Record<number, string> = {
      [aId]: "A: a flashcard app that uses spaced repetition.",
      [bId]: "B: a campus carpool matcher for night classes.",
      [cId]: "C: a laundry-machine availability tracker.",
    };

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

      const aSeesThree = untilTicketCount(a, 3);
      const bSeesThree = untilTicketCount(b, 3);
      const cSeesThree = untilTicketCount(c, 3);
      a.emit("room:submit-ticket", { body: "Pitch the flashcard app" });
      b.emit("room:submit-ticket", { body: "Pitch the carpool matcher" });
      c.emit("room:submit-ticket", { body: "Pitch the laundry tracker" });
      await Promise.all([
        withTimeout(aSeesThree, 10000, "a to see all three boarded tickets"),
        withTimeout(bSeesThree, 10000, "b to see all three boarded tickets"),
        withTimeout(cSeesThree, 10000, "c to see all three boarded tickets"),
      ]);

      await Promise.all([
        withTimeout(untilStatus(a, "focus"), TABLE_CYCLE_MS + 10000, "a to see focus status"),
        withTimeout(untilStatus(b, "focus"), TABLE_CYCLE_MS + 10000, "b to see focus status"),
        withTimeout(untilStatus(c, "focus"), TABLE_CYCLE_MS + 10000, "c to see focus status"),
      ]);

      await Promise.all([
        withTimeout(untilPitchOpened(a), TABLE_CYCLE_MS + 10000, "a to see the pitch portal open"),
        withTimeout(untilPitchOpened(b), TABLE_CYCLE_MS + 10000, "b to see the pitch portal open"),
        withTimeout(untilPitchOpened(c), TABLE_CYCLE_MS + 10000, "c to see the pitch portal open"),
      ]);

      // Same transient-2-way-then-settled-3-way reasoning as the Peer Review
      // rotation above — recomputePitchAssignments shares the same N-way
      // shuffle logic.
      const aPrelim = once<PitchAssignment>(a, "room:pitch-assignment");
      const bPrelim = once<PitchAssignment>(b, "room:pitch-assignment");
      a.emit("room:submit-pitch", { text: pitchText[aId] });
      b.emit("room:submit-pitch", { text: pitchText[bId] });
      await withTimeout(Promise.all([aPrelim, bPrelim]), 10000, "a and b to see the transient 2-way assignment before c submits");

      const aAssigned = once<PitchAssignment>(a, "room:pitch-assignment");
      const bAssigned = once<PitchAssignment>(b, "room:pitch-assignment");
      const cAssigned = once<PitchAssignment>(c, "room:pitch-assignment");
      c.emit("room:submit-pitch", { text: pitchText[cId] });
      const [aAssignment, bAssignment, cAssignment] = await withTimeout(
        Promise.all([aAssigned, bAssigned, cAssigned]),
        10000,
        "all three sockets to receive their N-way rotation assignment",
      );

      const listeners = [
        { socket: a, id: aId, assignment: aAssignment },
        { socket: b, id: bId, assignment: bAssignment },
        { socket: c, id: cId, assignment: cAssignment },
      ];
      const listenerOfA = listeners.find((l) => l.assignment.pitcherId === aId)!;
      const bystander = listeners.find((l) => l.id !== aId && l.id !== listenerOfA.id)!;

      const aSeesComment = untilTicketComment(a, aId, (comments) => comments.length > 0);
      const bystanderNextUpdate = once<RoomUpdate>(bystander.socket, "room:update");
      const COMMENT = "Clear value prop — how would you handle the cold-start problem?";
      listenerOfA.socket.emit("room:submit-pitch-comment", { pitcherId: aId, body: COMMENT });

      const aPayload = await withTimeout(aSeesComment, 5000, "a to see the listener's comment on their own ticket");
      const aComment = aPayload.tickets.find((t) => t.userId === aId)!.comments[0];
      expect(aComment.body).toBe(COMMENT);
      expect(aComment.fromUserId).toBe(listenerOfA.id);

      const bystanderPayload = await withTimeout(bystanderNextUpdate, 5000, "bystander to receive the redacted broadcast");
      const bystanderView = bystanderPayload.tickets.find((t) => t.userId === aId)!;
      expect(bystanderView.comments).toEqual([]);

      const notAssignedRejection = once<RoomError>(bystander.socket, "room:error");
      bystander.socket.emit("room:submit-pitch-comment", { pitcherId: aId, body: "I wasn't assigned this pitcher." });
      const notAssignedPayload = await withTimeout(notAssignedRejection, 5000, "room:error for commenting on a pitcher you weren't assigned to");
      expect(notAssignedPayload).toEqual({ error: "not_assigned", action: "room:submit-pitch-comment" });
    } finally {
      a.close();
      b.close();
      c.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// "hedley-l2" has "silent" claimed by whiteboard.test.ts — "problem" is free.
it(
  "lets any boarded user leave a free-form comment on a table-mate's ticket in Problem-Solving, and rejects commenting on your own ticket",
  async () => {
    const slug = "hedley-l2";
    const mode = "problem";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`fc-a-${uid}`);
    const bCookie = await registerAndGetCookie(`fc-b-${uid}`);
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
      a.emit("room:submit-ticket", { body: "Debug the failing test" });
      b.emit("room:submit-ticket", { body: "Debug the slow query" });
      await Promise.all([
        withTimeout(aSeesBoth, 10000, "a to see both boarded tickets"),
        withTimeout(bSeesBoth, 10000, "b to see both boarded tickets"),
      ]);

      await Promise.all([
        withTimeout(untilStatus(a, "focus"), TABLE_CYCLE_MS + 10000, "a to see focus status"),
        withTimeout(untilStatus(b, "focus"), TABLE_CYCLE_MS + 10000, "b to see focus status"),
      ]);

      // No portal-opened flag for the free-form comment box (it piggybacks on
      // the Whiteboard's Collab-phase gate, not a dedicated submission
      // mechanic) — waiting for the Collab subphase itself is what
      // whiteboardSubphaseOk (and so room:submit-ticket-comment) actually
      // checks.
      await Promise.all([
        withTimeout(untilSubphase(a, "collab"), TABLE_CYCLE_MS + 10000, "a to see the Collab subphase begin"),
        withTimeout(untilSubphase(b, "collab"), TABLE_CYCLE_MS + 10000, "b to see the Collab subphase begin"),
      ]);

      const aSeesComment = untilTicketComment(a, aId, (comments) => comments.length > 0);
      const COMMENT = "Have you checked the index is actually being used here?";
      b.emit("room:submit-ticket-comment", { toUserId: aId, body: COMMENT });
      const aPayload = await withTimeout(aSeesComment, 5000, "a to see b's free-form comment on their own ticket");
      const aComment = aPayload.tickets.find((t) => t.userId === aId)!.comments[0];
      expect(aComment.body).toBe(COMMENT);
      expect(aComment.fromUserId).toBe(bId);

      // Same self_kudos precedent as room:send-kudos — commenting on your own
      // ticket is rejected rather than silently accepted as a no-op.
      const selfRejection = once<RoomError>(a, "room:error");
      a.emit("room:submit-ticket-comment", { toUserId: aId, body: "Talking to myself here." });
      const selfPayload = await withTimeout(selfRejection, 5000, "room:error for commenting on your own ticket");
      expect(selfPayload).toEqual({ error: "self_comment", action: "room:submit-ticket-comment" });
    } finally {
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);

// "law" has "pitch" and "writing" claimed by peer-review.test.ts — "silent" is
// free, and demotion is mode-agnostic (the demoted check in every handler
// fires before any mode-specific gate), same as tab-telemetry.test.ts's own
// demotion test which also uses "silent".
it(
  "rejects every new comment handler with 'demoted' once a user has missed their check-in window",
  async () => {
    const slug = "law";
    const mode = "silent";
    const residentName = `demoted-cc-${randomUUID().slice(0, 8)}`;
    const residentCookie = await registerAndGetCookie(residentName);
    const watcherCookie = await registerAndGetCookie(`demoted-cc-w-${randomUUID().slice(0, 8)}`);

    const resident = connect(residentCookie);
    const watcher = connect(watcherCookie);
    try {
      await Promise.all([once(resident, "connect"), once(watcher, "connect")]);
      resident.emit("room:join", { slug, mode });
      await once(resident, "room:joined");
      await once(resident, "room:update");
      watcher.emit("room:join", { slug, mode });
      await once(watcher, "room:joined");
      await once(watcher, "room:update");

      const residentFocus = untilStatus(resident, "focus");
      const watcherFocus = untilStatus(watcher, "focus");
      resident.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(residentFocus, TABLE_CYCLE_MS + 10000, "resident to see focus status");
      await withTimeout(watcherFocus, TABLE_CYCLE_MS + 10000, "watcher to see focus update");

      const residentGone = new Promise<void>((resolve) => {
        const handler = (payload: { roster: { username: string }[] }): void => {
          if (!payload.roster.some((r) => r.username === residentName)) {
            watcher.off("room:update", handler);
            resolve();
          }
        };
        watcher.on("room:update", handler);
      });
      // Never confirming the check-in leaves the grace timeout to fire on its
      // own, same as tab-telemetry.test.ts's demotion test.
      await withTimeout(residentGone, CHECKIN_GRACE_MS + TABLE_CYCLE_MS + 10000, "roster to drop the demoted resident");

      // Each handler's guard checks isDemoted() before anything else (mode,
      // assignment, body validity), so garbage arguments still surface
      // "demoted" rather than some other error — proving demotion, not the
      // argument shape, is what's actually being rejected here.
      const reviewCommentRejection = once<RoomError>(resident, "room:error");
      resident.emit("room:submit-review-comment", { authorId: -1, body: "x" });
      expect(await withTimeout(reviewCommentRejection, 5000, "room:error for demoted room:submit-review-comment")).toEqual({
        error: "demoted",
        action: "room:submit-review-comment",
      });

      const submitPitchRejection = once<RoomError>(resident, "room:error");
      resident.emit("room:submit-pitch", { text: "x" });
      expect(await withTimeout(submitPitchRejection, 5000, "room:error for demoted room:submit-pitch")).toEqual({
        error: "demoted",
        action: "room:submit-pitch",
      });

      const pitchCommentRejection = once<RoomError>(resident, "room:error");
      resident.emit("room:submit-pitch-comment", { pitcherId: -1, body: "x" });
      expect(await withTimeout(pitchCommentRejection, 5000, "room:error for demoted room:submit-pitch-comment")).toEqual({
        error: "demoted",
        action: "room:submit-pitch-comment",
      });

      const ticketCommentRejection = once<RoomError>(resident, "room:error");
      resident.emit("room:submit-ticket-comment", { toUserId: -1, body: "x" });
      expect(await withTimeout(ticketCommentRejection, 5000, "room:error for demoted room:submit-ticket-comment")).toEqual({
        error: "demoted",
        action: "room:submit-ticket-comment",
      });
    } finally {
      resident.close();
      watcher.close();
    }
  },
  TABLE_CYCLE_MS + CHECKIN_GRACE_MS + 30000,
);

// "chifley" has "silent" claimed by disconnect-during-break-vfh.test.ts —
// "writing" is free. A Shadow socket is rejected immediately (no cycle wait
// needed), same reasoning as shadow-view.test.ts: isShadow is set the moment
// an uncookied socket joins, before any ticket is ever boarded.
it("rejects every new comment handler with 'unauthorized' for a Shadow socket", async () => {
  const slug = "chifley";
  const mode = "writing";
  const shadow = connect();
  try {
    await once(shadow, "connect");
    shadow.emit("room:join", { slug, mode });
    const joined = await once<{ isShadow: boolean }>(shadow, "room:joined");
    expect(joined.isShadow).toBe(true);
    await once(shadow, "room:update");

    const reviewCommentRejection = once<RoomError>(shadow, "room:error");
    shadow.emit("room:submit-review-comment", { authorId: -1, body: "x" });
    expect(await withTimeout(reviewCommentRejection, 5000, "room:error for shadow room:submit-review-comment")).toEqual({
      error: "unauthorized",
      action: "room:submit-review-comment",
    });

    const submitPitchRejection = once<RoomError>(shadow, "room:error");
    shadow.emit("room:submit-pitch", { text: "x" });
    expect(await withTimeout(submitPitchRejection, 5000, "room:error for shadow room:submit-pitch")).toEqual({
      error: "unauthorized",
      action: "room:submit-pitch",
    });

    const pitchCommentRejection = once<RoomError>(shadow, "room:error");
    shadow.emit("room:submit-pitch-comment", { pitcherId: -1, body: "x" });
    expect(await withTimeout(pitchCommentRejection, 5000, "room:error for shadow room:submit-pitch-comment")).toEqual({
      error: "unauthorized",
      action: "room:submit-pitch-comment",
    });

    const ticketCommentRejection = once<RoomError>(shadow, "room:error");
    shadow.emit("room:submit-ticket-comment", { toUserId: -1, body: "x" });
    expect(await withTimeout(ticketCommentRejection, 5000, "room:error for shadow room:submit-ticket-comment")).toEqual({
      error: "unauthorized",
      action: "room:submit-ticket-comment",
    });
  } finally {
    shadow.close();
  }
});
