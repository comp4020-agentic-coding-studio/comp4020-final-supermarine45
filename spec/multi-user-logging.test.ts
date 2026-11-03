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

function connect(cookie?: string): Socket {
  return io(baseUrl, { extraHeaders: cookie ? { cookie } : {}, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function untilStatus(socket: Socket, status: string): Promise<{ timer: { status: string } }> {
  return new Promise((resolve) => {
    const handler = (payload: { timer: { status: string } }): void => {
      if (payload.timer.status === status) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// An unbounded wait here would hang this test's own cleanup forever if the
// table was ever left wedged by something other than this run.
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

type LogCategory = "activity" | "system" | "status";

// The spec suite never assumes filesystem or Docker access to the app under
// test (see spec/global-setup.ts) — in CI it runs inside a container with an
// ephemeral /data this process can't read. src/routes/pages.ts exposes a
// read-only tail of each log file over HTTP for exactly this reason, so log
// *content* can be asserted on the same way everything else in this suite
// is: by asking the running app, not its disk.
async function fetchLogLines(category: LogCategory): Promise<string[]> {
  const res = await fetch(new URL(`/api/logs/${category}?limit=1000`, baseUrl));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { lines: string[] };
  return body.lines;
}

// Other spec files hit this same live server concurrently and log to the
// same files, so a line of interest isn't guaranteed to be the very last one
// by the time this polls — but it is guaranteed to show up, since
// appendFileSync runs synchronously inside the handler, strictly before the
// socket event that told us to look for it is even emitted.
function waitForLogLine(category: LogCategory, predicate: (line: string) => boolean, ms = 10000): Promise<string> {
  return withTimeout(
    (async () => {
      for (;;) {
        const lines = await fetchLogLines(category);
        const found = lines.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    })(),
    ms,
    `${category} log to contain a matching line`,
  );
}

// A slug not used by any other spec file (same reasoning as
// lobby-override-race.test.ts and shadow-view.test.ts): lets this run
// concurrently with the rest of the suite against the same live server
// without state bleeding across files. Room name per src/db.ts's
// SEED_LOCATIONS: "Quiet Room".
const slug = "kambri-quiet";
const mode = "silent";
const ROOM_NAME = "Quiet Room";

// Exercises three identities at the same table — two real users and one
// unauthenticated Shadow — across a system-logged event (joining) and three
// activity-logged events (a ticket submission, a kudos send, and a rejected
// unauthorized attempt), then checks the *actual logged lines* the server
// wrote, not just the socket-visible side effects. This is the thing
// CLAUDE.md's Strava-for-studying stats and the system/activity split in
// src/logger.ts exist to be trustworthy for, so it's worth proving end to
// end: every participant shows up under the right identity and room, and —
// just as important — a system-category event never leaks into the activity
// log or vice versa.
it(
  "logs each participant's join under system and their ticket/kudos/rejected actions under activity, without the two mixing",
  async () => {
    const aName = `log-a-${randomUUID().slice(0, 8)}`;
    const bName = `log-b-${randomUUID().slice(0, 8)}`;
    const aCookie = await registerAndGetCookie(aName);
    const bCookie = await registerAndGetCookie(bName);
    const aUserId = await getUserId(aCookie);

    const a = connect(aCookie);
    const b = connect(bCookie);
    const shadow = connect();
    try {
      await Promise.all([once(a, "connect"), once(b, "connect"), once(shadow, "connect")]);

      a.emit("room:join", { slug, mode });
      await once(a, "room:joined");
      await once(a, "room:update");
      b.emit("room:join", { slug, mode });
      await once(b, "room:joined");
      await once(b, "room:update");
      shadow.emit("room:join", { slug, mode });
      await once(shadow, "room:joined");
      await once(shadow, "room:update");

      // Join-timing is system-logged (logSystemAction), one line per real
      // participant — a Shadow has no identity worth logging a join under,
      // and indeed the join handler never calls logSystemAction for one.
      const aJoinLine = await waitForLogLine(
        "system",
        (line) => line.includes(`[Room: ${ROOM_NAME}]`) && line.includes(`'${aName}'`) && line.includes(`Joined ${mode}.`),
      );
      expect(aJoinLine).toContain("[System]");
      const bJoinLine = await waitForLogLine(
        "system",
        (line) => line.includes(`[Room: ${ROOM_NAME}]`) && line.includes(`'${bName}'`) && line.includes(`Joined ${mode}.`),
      );
      expect(bJoinLine).toContain("[System]");

      // The unauthenticated Shadow has no write access (see
      // shadow-view.test.ts) — the rejection itself is also activity-logged,
      // under its session id rather than a username, since it was never one.
      const rejection = once<{ error: string; action: string }>(shadow, "room:error");
      shadow.emit("room:submit-ticket", { body: "A shadow's ticket" });
      const payload = await withTimeout(rejection, 5000, "room:error for the Shadow's attempt");
      expect(payload).toEqual({ error: "unauthorized", action: "room:submit-ticket" });

      const rejectionLine = await waitForLogLine(
        "activity",
        (line) => line.includes(`Session ${shadow.id}`) && line.includes("Attempted unauthorized room:submit-ticket. Rejected."),
      );
      expect(rejectionLine).toContain("[Activity]");
      expect(rejectionLine).toContain(`[Room: ${ROOM_NAME}]`);

      // A boards a ticket — activity-logged with the ticket body — and the
      // scheduler's own cycle mark carries the table into focus. No manual
      // start exists anymore (Decision 2), so this waits out the real
      // scheduler the same way every other rewritten file does.
      const sawFocus = untilStatus(a, "focus");
      a.emit("room:submit-ticket", { body: "Read two chapters" });
      await sawFocus;

      const ticketLine = await waitForLogLine(
        "activity",
        (line) => line.includes(`'${aName}'`) && line.includes(`Submitted ticket for ${mode}`),
      );
      expect(ticketLine).toContain("[Activity]");
      expect(ticketLine).toContain(`[Room: ${ROOM_NAME}]`);

      // B gives A Kudos once the table reaches break — also activity-logged,
      // under B's own identity, naming the recipient by username.
      await untilStatus(b, "break");
      b.emit("room:send-kudos", { toUserId: aUserId, emoji: "⚡" });

      const kudosLine = await waitForLogLine(
        "activity",
        (line) => line.includes(`'${bName}'`) && line.includes(`Sent ⚡ kudos to '${aName}'`),
      );
      expect(kudosLine).toContain("[Activity]");
      expect(kudosLine).toContain(`[Room: ${ROOM_NAME}]`);

      // No cross-contamination: the join-timing lines never show up in the
      // activity stream, and the ticket/kudos/rejection lines never show up
      // in the system stream — the whole point of splitting them in
      // src/logger.ts.
      const [systemLines, activityLines] = await Promise.all([fetchLogLines("system"), fetchLogLines("activity")]);
      expect(activityLines.some((line) => line.includes(`'${aName}'`) && line.includes(`Joined ${mode}.`))).toBe(false);
      expect(activityLines.some((line) => line.includes(`'${bName}'`) && line.includes(`Joined ${mode}.`))).toBe(false);
      expect(systemLines.some((line) => line.includes("Submitted ticket for"))).toBe(false);
      expect(systemLines.some((line) => line.includes("kudos to"))).toBe(false);
      expect(systemLines.some((line) => line.includes("Attempted unauthorized"))).toBe(false);
    } finally {
      // No manual reset exists anymore (Decision 2) — just disconnect.
      a.close();
      b.close();
      shadow.close();
    }
  },
  TABLE_CYCLE_MS * 2 + 30000,
);
