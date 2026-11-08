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
  leaderUserId: number | null;
  whiteboardOpenedAt: number | null;
  whiteboardText: string;
  whiteboardHighlights: { start: number; end: number; byUserId: number }[];
};
type RoomError = { error: string; action: string };
type CursorEvent = { userId: number; x: number; y: number };

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

function untilWhiteboardOpened(socket: Socket): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.whiteboardOpenedAt !== null) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

function untilWhiteboardText(socket: Socket, text: string): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.whiteboardText === text) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

function untilHighlightCount(socket: Socket, count: number): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      if (payload.whiteboardHighlights.length === count) {
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

// whiteboardSubphaseOk (src/rooms.ts) checks mode === "problem" before it
// ever looks at table status or subphase, so every whiteboard action is
// rejected wrong_mode in any other mode immediately — no cycle wait needed.
it("rejects room:whiteboard-paste outside Problem-Solving mode with wrong_mode", async () => {
  const slug = "hedley-l2";
  const mode = "silent";
  const cookie = await registerAndGetCookie(`wb-wrongmode-${randomUUID().slice(0, 8)}`);

  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug, mode });
    await once(socket, "room:joined");
    await once(socket, "room:update");

    const rejection = once<RoomError>(socket, "room:error");
    socket.emit("room:whiteboard-paste", { text: "hi" });
    const payload = await withTimeout(rejection, 5000, "room:error for whiteboard-paste outside Problem-Solving");
    expect(payload).toEqual({ error: "wrong_mode", action: "room:whiteboard-paste" });
  } finally {
    socket.close();
  }
});

// The whole Whiteboard story inside one Collab window: it auto-opens for
// everyone the instant Collab starts (armWhiteboardTimer, same pattern as
// Peer Review — no manual "Launch" step, and no one boarder is favored over
// another), and paste/highlight sync live to the other viewer, and a live
// cursor reaches the other socket but never the sender and never rides
// room:update. Collab is only a few seconds wide at CI's test-speed cycle
// (splitMinutes 40 of 50 means an 80%-elapsed split, with focus ending at
// 100%), so every step fires the moment its predecessor's broadcast confirms,
// with no incidental sleeps except the one deliberately placed last (proving
// the sender never gets its own cursor back) — nothing after that point
// still needs Collab to be open.
it(
  "auto-opens the whiteboard for every boarded participant at the Collab split (no manual launch), then live-syncs paste/highlight and relays cursor to others but never the sender",
  async () => {
    const slug = "hedley-common";
    const mode = "problem";
    const uid = randomUUID().slice(0, 8);
    const aCookie = await registerAndGetCookie(`whiteboard-a-${uid}`);
    const bCookie = await registerAndGetCookie(`whiteboard-b-${uid}`);
    const aId = await getUserId(aCookie);
    const bId = await getUserId(bCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    // Installed from the very start (not just around the cursor emit) so the
    // final "never appears in any room:update payload" check inspects every
    // broadcast this test produces — ticket boards, focus/collab transitions,
    // whiteboard open, paste, and highlight all included — rather than only
    // whatever happens to fire in a narrow post-emit window.
    const watchedUpdates: RoomUpdate[] = [];
    const captureUpdate = (payload: RoomUpdate): void => {
      watchedUpdates.push(payload);
    };
    a.on("room:update", captureUpdate);
    b.on("room:update", captureUpdate);
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

      const aFocus = untilStatus(a, "focus");
      const bFocus = untilStatus(b, "focus");
      await withTimeout(aFocus, TABLE_CYCLE_MS + 10000, "a to see focus status");
      await withTimeout(bFocus, TABLE_CYCLE_MS + 10000, "b to see focus update");

      // The server opens the whiteboard itself the instant Collab starts, with
      // no client action required — wait for whiteboardOpenedAt directly
      // rather than the subphase flag, since that's the actual gate every
      // other whiteboard action checks (whiteboardSubphaseOk).
      const opened = Promise.all([untilWhiteboardOpened(a), untilWhiteboardOpened(b)]);
      const [openedA, openedB] = await withTimeout(opened, TABLE_CYCLE_MS + 10000, "both sockets to see whiteboardOpenedAt auto-set at the Collab split");
      expect(openedA.whiteboardOpenedAt).not.toBeNull();
      expect(openedB.whiteboardOpenedAt).toBe(openedA.whiteboardOpenedAt);

      const bSeesPaste = untilWhiteboardText(b, "def solve():");
      a.emit("room:whiteboard-paste", { text: "def solve():" });
      const pastePayload = await withTimeout(bSeesPaste, 5000, "b to see a's pasted text");
      expect(pastePayload.whiteboardText).toBe("def solve():");

      const aSeesHighlight = untilHighlightCount(a, 1);
      b.emit("room:whiteboard-highlight", { start: 0, end: 3 });
      const highlightPayload = await withTimeout(aSeesHighlight, 5000, "a to see b's highlight");
      expect(highlightPayload.whiteboardHighlights).toEqual([{ start: 0, end: 3, byUserId: bId }]);

      const bGotCursor = once<CursorEvent>(b, "whiteboard:cursor");
      let aSawOwnCursor = false;
      a.once("whiteboard:cursor", () => {
        aSawOwnCursor = true;
      });

      a.emit("room:whiteboard-cursor", { x: 12.5, y: 40 });
      const cursorPayload = await withTimeout(bGotCursor, 5000, "b to receive a's whiteboard:cursor");
      expect(cursorPayload).toEqual({ userId: aId, x: 12.5, y: 40 });

      // Prove the negatives last, since nothing after this needs Collab to
      // still be open: the sender never gets its own cursor echoed back, and
      // no room:update broadcast captured since the sockets connected (ticket
      // boards, focus/collab transitions, whiteboard open, paste, highlight,
      // all included) ever carries cursor data — it rides a wholly separate
      // event, never broadcastRoom.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(aSawOwnCursor).toBe(false);
      expect(watchedUpdates.length).toBeGreaterThan(0);
      for (const update of watchedUpdates) {
        expect(JSON.stringify(update).toLowerCase()).not.toContain("cursor");
      }
    } finally {
      a.off("room:update", captureUpdate);
      b.off("room:update", captureUpdate);
      a.close();
      b.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);
