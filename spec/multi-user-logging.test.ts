import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";

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

type VotePayload = { timer: { status: string }; votes: { minutes: number; count: number }[] };

function untilVoteCount(socket: Socket, minutes: number, count: number): Promise<VotePayload> {
  return new Promise((resolve) => {
    const handler = (payload: VotePayload): void => {
      if (payload.votes.some((v) => v.minutes === minutes && v.count === count)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// See spec/concurrent-edits.test.ts for why this is capped: an unbounded
// wait here would hang this test's own cleanup forever if the room was ever
// left wedged by something other than this run.
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
// appendFileSync runs synchronously inside the handler before the
// socket event that told us to look ever reaches us.
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
// voting-resolution.test.ts and shadow-view.test.ts): lets this run
// concurrently with the rest of the suite against the same live server
// without state bleeding across files. Room name per src/db.ts's
// SEED_LOCATIONS: "Quiet Room".
const slug = "kambri-quiet";
const ROOM_NAME = "Quiet Room";

// Exercises three identities in the same room — two real users and one
// unauthenticated Shadow — across both a system-logged event (joining) and
// several activity-logged events (casting/changing a lobby vote, and an
// unauthorized attempt), then checks the *actual logged lines* the server
// wrote, not just the socket-visible side effects. This is the thing
// CLAUDE.md's Crit Logging rule and the system/activity split in
// src/logger.ts exist for, so it's worth proving end to end: every
// participant shows up under the right identity and room, and — just as
// important — a system-category event never leaks into the activity log or
// vice versa.
it(
  "logs each participant's join under system and their voting/rejected actions under activity, without the two mixing",
  async () => {
    const aName = `log-a-${randomUUID().slice(0, 8)}`;
    const bName = `log-b-${randomUUID().slice(0, 8)}`;
    const aCookie = await registerAndGetCookie(aName);
    const bCookie = await registerAndGetCookie(bName);

    const a = connect(aCookie);
    const b = connect(bCookie);
    const shadow = connect();
    try {
      await Promise.all([once(a, "connect"), once(b, "connect"), once(shadow, "connect")]);

      a.emit("room:join", { slug });
      await once(a, "room:update");
      b.emit("room:join", { slug });
      await once(b, "room:update");
      shadow.emit("room:join", { slug });
      await once(shadow, "room:update");

      // Join-timing is system-logged (logSystemAction), one line per
      // participant, independent of anything any of them goes on to do.
      const aJoinLine = await waitForLogLine(
        "system",
        (line) => line.includes(`[Room: ${ROOM_NAME}]`) && line.includes(`'${aName}'`) && line.includes("connected"),
      );
      expect(aJoinLine).toContain("[System]");
      const bJoinLine = await waitForLogLine(
        "system",
        (line) => line.includes(`[Room: ${ROOM_NAME}]`) && line.includes(`'${bName}'`) && line.includes("connected"),
      );
      expect(bJoinLine).toContain("[System]");

      // Multi-user voting: a starts the lobby, b casts then changes a vote —
      // both are activity-logged (logRoomAction) with distinct wording.
      a.emit("room:start-lobby");
      await untilStatus(a, "lobby");
      await untilStatus(b, "lobby");

      b.emit("room:vote", { minutes: 25 });
      await untilVoteCount(a, 25, 1);
      b.emit("room:vote", { minutes: 45 });
      await untilVoteCount(a, 45, 1);

      const voteCastLine = await waitForLogLine(
        "activity",
        (line) => line.includes(`'${bName}'`) && line.includes("voted for a 25-minute block"),
      );
      expect(voteCastLine).toContain("[Activity]");
      expect(voteCastLine).toContain(`[Room: ${ROOM_NAME}]`);

      const voteChangeLine = await waitForLogLine(
        "activity",
        (line) => line.includes(`'${bName}'`) && line.includes("changed vote from 25 to 45 minutes"),
      );
      expect(voteChangeLine).toContain("[Activity]");

      // The unauthenticated Shadow has no write access (see
      // shadow-view.test.ts) — the rejection itself is also activity-logged,
      // under its session id rather than a username, since it was never one.
      const rejection = once<{ error: string; action: string }>(shadow, "room:unauthorized");
      shadow.emit("room:start-focus", { minutes: 25 });
      const payload = await withTimeout(rejection, 5000, "room:unauthorized for the Shadow's attempt");
      expect(payload.error).toBe("unauthorized");

      const rejectionLine = await waitForLogLine(
        "activity",
        (line) => line.includes(`Session ${shadow.id}`) && line.includes("attempted unauthorized room:start-focus. Rejected."),
      );
      expect(rejectionLine).toContain("[Activity]");
      expect(rejectionLine).toContain(`[Room: ${ROOM_NAME}]`);

      // No cross-contamination: the join-timing lines never show up in the
      // activity stream, and the voting/rejection lines never show up in the
      // system stream — the whole point of splitting them in src/logger.ts.
      const [systemLines, activityLines] = await Promise.all([fetchLogLines("system"), fetchLogLines("activity")]);
      expect(activityLines.some((line) => line.includes(`'${aName}'`) && line.includes("connected"))).toBe(false);
      expect(activityLines.some((line) => line.includes(`'${bName}'`) && line.includes("connected"))).toBe(false);
      expect(systemLines.some((line) => line.includes("voted for a 25-minute block"))).toBe(false);
      expect(systemLines.some((line) => line.includes("changed vote from 25 to 45 minutes"))).toBe(false);
      expect(systemLines.some((line) => line.includes("attempted unauthorized room:start-focus"))).toBe(false);
    } finally {
      // a started the lobby, so a is who resetRoom's started_by-only check
      // expects — wait for b's own idle broadcast before closing, but
      // bounded (see spec/concurrent-edits.test.ts for the full rationale).
      const bSawIdle = untilStatus(b, "idle");
      a.emit("room:reset");
      await withTimeout(bSawIdle, 5000, "room to confirm reset").catch(() => {});
      a.close();
      b.close();
      shadow.close();
    }
  },
  20000,
);
