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

type Ticket = { userId: number; stuck: boolean };
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

function untilTicketStuck(socket: Socket, userId: number, stuck: boolean): Promise<RoomUpdate> {
  return new Promise((resolve) => {
    const handler = (payload: RoomUpdate): void => {
      const mine = payload.tickets.find((t) => t.userId === userId);
      if (mine && mine.stuck === stuck) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// An unbounded wait would hang this test's own cleanup forever if the server
// never broadcast the expected state at all — same reasoning as every other
// rewritten file in this suite.
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

// The Stuck flag is Problem-Solving mode's own signal ("I'm blocked, come
// swarm this with me" at the Collab-Phase unlock) — it only means anything at
// a Problem-Solving table, and the toggle is live (no artificial reveal
// delay), so every other boarded participant sees it flip in real time, not
// just the toggler's own socket.
it(
  "toggles a ticket's stuck flag live for every table member, only in Problem-Solving mode",
  async () => {
    const slug = "chifley-l3";
    const mode = "problem";
    const uid = randomUUID().slice(0, 8);
    const residentCookie = await registerAndGetCookie(`stuck-resident-${uid}`);
    const watcherCookie = await registerAndGetCookie(`stuck-watcher-${uid}`);
    const residentId = await getUserId(residentCookie);

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

      // No manual start exists anymore (Decision 2) — board a ticket and wait
      // out the real scheduler's cycle mark, same pattern as every other
      // rewritten file.
      const residentFocus = untilStatus(resident, "focus");
      const watcherFocus = untilStatus(watcher, "focus");
      resident.emit("room:submit-ticket", { body: "Stuck on recursion proof" });
      await withTimeout(residentFocus, TABLE_CYCLE_MS + 10000, "resident to see focus status");
      await withTimeout(watcherFocus, TABLE_CYCLE_MS + 10000, "watcher to see focus update");

      const watcherSeesStuck = untilTicketStuck(watcher, residentId, true);
      resident.emit("room:toggle-stuck");
      const stuckPayload = await withTimeout(watcherSeesStuck, 5000, "watcher to see the resident's ticket flip to stuck");
      expect(stuckPayload.tickets.find((t) => t.userId === residentId)?.stuck).toBe(true);

      const watcherSeesUnstuck = untilTicketStuck(watcher, residentId, false);
      resident.emit("room:toggle-stuck");
      const unstuckPayload = await withTimeout(
        watcherSeesUnstuck,
        5000,
        "watcher to see the resident's ticket flip back to not-stuck",
      );
      expect(unstuckPayload.tickets.find((t) => t.userId === residentId)?.stuck).toBe(false);
    } finally {
      resident.close();
      watcher.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);

// Every other mode has no Stuck concept at all — Silent Focus has no
// collaboration phase to swarm into, and Writing/Pitch's collab phase is
// screen-swap/out-loud, not blocker-triage. The handler gates on mode alone
// (src/rooms.ts's room:toggle-stuck), independent of table occupancy or phase.
it(
  "rejects toggling stuck outside Problem-Solving mode with wrong_mode",
  async () => {
    const slug = "hancock-l2";
    const mode = "silent";
    const cookie = await registerAndGetCookie(`stuck-wrongmode-${randomUUID().slice(0, 8)}`);

    const socket = connect(cookie);
    try {
      await once(socket, "connect");
      socket.emit("room:join", { slug, mode });
      await once(socket, "room:joined");
      await once(socket, "room:update");

      const sawFocus = untilStatus(socket, "focus");
      socket.emit("room:submit-ticket", { body: "Read two chapters" });
      await withTimeout(sawFocus, TABLE_CYCLE_MS + 10000, "socket to see focus status");

      const rejection = once<RoomError>(socket, "room:error");
      socket.emit("room:toggle-stuck");
      const payload = await withTimeout(rejection, 5000, "room:error for toggle-stuck in the wrong mode");
      expect(payload).toEqual({ error: "wrong_mode", action: "room:toggle-stuck" });
    } finally {
      socket.close();
    }
  },
  TABLE_CYCLE_MS + 20000,
);
