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

type Ticket = { userId: number };
type RoomUpdate = {
  timer: { status: string; subphase: string | null };
  tickets: Ticket[];
  peerReviewOpenedAt: number | null;
};
type RoomError = { error: string; action: string };
type PeerReviewHighlightKind = "strong" | "confusing" | "citation";
type PeerReviewHighlight = { start: number; end: number; kind: PeerReviewHighlightKind; byUserId: number };
type PeerReviewAssignment = { authorId: number; authorUsername: string; text: string; highlights: PeerReviewHighlight[] };
type PeerReviewHighlightsPayload = { highlights: PeerReviewHighlight[] };

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

// The Peer Review portal auto-opens at the writing mode split point
// (armPeerReviewTimer), with no manual "Launch" step unlike the Whiteboard —
// so every test here waits for peerReviewOpenedAt to actually land on
// room:update rather than inferring it from the collab subphase flag alone,
// since room:submit-draft itself gates on both being true.
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

// broadcastPeerReviewState (src/rooms.ts) re-emits room:peer-review-highlights
// to every drafter on every assignment recompute, not just on an actual
// highlight — so a drafter can see several empty payloads (from each prior
// submission's broadcast) before the one that actually carries a highlight.
// Waiting for the first non-empty payload, rather than the first payload
// full stop, is what makes this deterministic regardless of how many
// transient empty broadcasts preceded it.
function untilNonEmptyHighlights(socket: Socket): Promise<PeerReviewHighlightsPayload> {
  return new Promise((resolve) => {
    const handler = (payload: PeerReviewHighlightsPayload): void => {
      if (payload.highlights.length > 0) {
        socket.off("room:peer-review-highlights", handler);
        resolve(payload);
      }
    };
    socket.on("room:peer-review-highlights", handler);
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

// peerReviewSubphaseOk (src/rooms.ts) checks mode === "writing" before it
// ever looks at table status or subphase, so room:submit-draft is rejected
// wrong_mode in any other mode immediately — no cycle wait needed. Uses the
// "pitch" mode at the same "law" location as the main test below, which is a
// distinct table (tables key jointly by (locationId, activityMode)) so the
// two tests never interact.
it("rejects room:submit-draft outside Writing Clinic mode with wrong_mode", async () => {
  const slug = "law";
  const mode = "pitch";
  const cookie = await registerAndGetCookie(`pr-wrongmode-${randomUUID().slice(0, 8)}`);

  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const rejection = once<RoomError>(socket, "room:error");
    socket.emit("room:submit-draft", { text: "A short draft, just to prove the gate." });
    const payload = await withTimeout(rejection, 5000, "room:error for submit-draft outside Writing Clinic");
    expect(payload).toEqual({ error: "wrong_mode", action: "room:submit-draft" });
  } finally {
    socket.close();
  }
});

// "law" has zero other uses anywhere in spec/ (confirmed by grep), so this
// table's state is wholly owned by this test file.
it(
  "shuffles submitted drafts into an N-way rotation and live-replicates a reviewer's highlight onto the original author's own screen",
  async () => {
    const slug = "law";
    const mode = "writing";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`pr-a-${uid}`);
    const bCookie = await registerAndGetCookie(`pr-b-${uid}`);
    const cCookie = await registerAndGetCookie(`pr-c-${uid}`);
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

      // Submitting fewer than 2 drafts leaves nothing to assign, but
      // recomputePeerReviewAssignments runs the shuffle at n >= 2 — so b's
      // submission (the 2nd) already triggers a transient reciprocal 2-way
      // assignment broadcast to a and b, before c ever joins the rotation.
      // Waiting for that transient broadcast to actually land here (and
      // discarding it) is what lets the once() listeners registered below
      // deterministically catch only the settled 3-way broadcast c's
      // submission triggers — registering them any earlier would race a
      // fresh listener against that already-in-flight 2-way event.
      const aPrelim = once<PeerReviewAssignment>(a, "room:peer-review-assignment");
      const bPrelim = once<PeerReviewAssignment>(b, "room:peer-review-assignment");
      a.emit("room:submit-draft", { text: draftText[aId] });
      b.emit("room:submit-draft", { text: draftText[bId] });
      await withTimeout(
        Promise.all([aPrelim, bPrelim]),
        10000,
        "a and b to see the transient 2-way assignment before c submits",
      );

      const aAssigned = once<PeerReviewAssignment>(a, "room:peer-review-assignment");
      const bAssigned = once<PeerReviewAssignment>(b, "room:peer-review-assignment");
      const cAssigned = once<PeerReviewAssignment>(c, "room:peer-review-assignment");
      c.emit("room:submit-draft", { text: draftText[cId] });

      const [aAssignment, bAssignment, cAssignment] = await withTimeout(
        Promise.all([aAssigned, bAssigned, cAssigned]),
        10000,
        "all three sockets to receive their N-way rotation assignment",
      );

      // Nobody is assigned to review their own draft...
      expect(aAssignment.authorId).not.toBe(aId);
      expect(bAssignment.authorId).not.toBe(bId);
      expect(cAssignment.authorId).not.toBe(cId);
      // ...and the three assigned authors form a full permutation of {a,b,c}
      // — every draft gets exactly one reviewer, rather than two reviewers
      // piling onto one draft while another goes unreviewed.
      const assignedAuthorIds = [aAssignment.authorId, bAssignment.authorId, cAssignment.authorId].slice().sort();
      expect(assignedAuthorIds).toEqual([aId, bId, cId].slice().sort());
      // The assignment carries the actual draft content, not just an id.
      expect(aAssignment.text).toBe(draftText[aAssignment.authorId]);
      expect(aAssignment.highlights).toEqual([]);

      const reviewers = [
        { socket: a, id: aId, assignment: aAssignment },
        { socket: b, id: bId, assignment: bAssignment },
        { socket: c, id: cId, assignment: cAssignment },
      ];
      const reviewerOfA = reviewers.find((r) => r.assignment.authorId === aId)!;

      // The assigned reviewer highlights a's draft; a never asked for it and
      // never emitted anything themselves, but should see it live on their
      // own screen via the targeted room:peer-review-highlights event — the
      // "Live Replicated Effect" the feature describes.
      const aSeesHighlight = untilNonEmptyHighlights(a);
      reviewerOfA.socket.emit("room:peer-highlight", { authorId: aId, start: 0, end: 5, kind: "strong" });
      const highlightPayload = await withTimeout(
        aSeesHighlight,
        5000,
        "a to see a live-replicated highlight land on their own draft",
      );
      expect(highlightPayload.highlights).toEqual([{ start: 0, end: 5, kind: "strong", byUserId: reviewerOfA.id }]);

      // The same reviewer may not highlight a draft the rotation didn't
      // assign them — proving the server checks the actual assignment, not
      // just "anyone at the table may highlight anyone".
      const wrongAuthorId = bId;
      const notAssignedRejection = once<RoomError>(reviewerOfA.socket, "room:error");
      reviewerOfA.socket.emit("room:peer-highlight", { authorId: wrongAuthorId, start: 0, end: 3, kind: "confusing" });
      const notAssignedPayload = await withTimeout(
        notAssignedRejection,
        5000,
        "room:error for highlighting a draft you weren't assigned to review",
      );
      expect(notAssignedPayload).toEqual({ error: "not_assigned", action: "room:peer-highlight" });
    } finally {
      a.close();
      b.close();
      c.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);
