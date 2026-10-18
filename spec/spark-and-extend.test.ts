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

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type TimerPayload = {
  status: string;
  phaseEndAt: number | null;
  durationMs: number | null;
  startedByUsername: string | null;
};

function untilStatus(socket: Socket, status: string): Promise<{ timer: TimerPayload }> {
  return new Promise((resolve) => {
    const handler = (payload: { timer: TimerPayload }): void => {
      if (payload.timer.status === status) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    };
    socket.on("room:update", handler);
  });
}

// See spec/concurrent-edits.test.ts for the full rationale: an unbounded wait
// here can hang past vitest's default test timeout (and, if it's the
// finally-block cleanup wait, hang forever afterward) rather than failing
// fast with a clear reason.
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

// A spark now carries a server-picked encouraging line (not user-typed text)
// and is broadcast to the sender too, since the message only exists once the
// server chooses it — there's no local copy to echo instantly on click. Both
// properties, plus the pre-existing per-user cooldown, are worth locking down
// end-to-end: this is the one live signal a focused user can still send, and
// it must stay system-chosen so it can never become a disguised chat channel.
it(
  "broadcasts a spark with a non-empty, system-chosen message to everyone including the sender, and rejects an immediate repeat",
  async () => {
    const slug = "hancock-l2";
    const senderCookie = await registerAndGetCookie(`spark-sender-${randomUUID().slice(0, 8)}`);
    const otherCookie = await registerAndGetCookie(`spark-other-${randomUUID().slice(0, 8)}`);

    const sender = connect(senderCookie);
    const other = connect(otherCookie);
    try {
      await Promise.all([once(sender, "connect"), once(other, "connect")]);

      sender.emit("room:join", { slug });
      await once(sender, "room:update");
      other.emit("room:join", { slug });
      await once(other, "room:update");

      const senderFocus = untilStatus(sender, "focus");
      sender.emit("room:start-focus", { minutes: 15 });
      await withTimeout(senderFocus, 10000, "sender to see focus status");
      await withTimeout(once(other, "room:update"), 10000, "other to see focus update");

      const senderSpark = once<{ username: string; message: string }>(sender, "focus_spark");
      const otherSpark = once<{ username: string; message: string }>(other, "focus_spark");
      sender.emit("focus_spark");
      const [senderResult, otherResult] = await withTimeout(
        Promise.all([senderSpark, otherSpark]),
        10000,
        "both sides to see the spark",
      );

      for (const result of [senderResult, otherResult]) {
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
        expect(result.username).toMatch(/^spark-sender-/);
      }
      // Everyone sees the identical server-chosen line for a given spark.
      expect(otherResult.message).toBe(senderResult.message);

      // A second spark fired immediately after is suppressed by the 10s
      // per-user cooldown — no second event arrives within a short window.
      let repeatArrived = false;
      const repeatListener = (): void => {
        repeatArrived = true;
      };
      other.once("focus_spark", repeatListener);
      sender.emit("focus_spark");
      await new Promise((resolve) => setTimeout(resolve, 300));
      other.off("focus_spark", repeatListener);
      expect(repeatArrived).toBe(false);
    } finally {
      // Closing sender immediately after emit() can drop the reset packet
      // before it flushes, leaving the room stuck mid-focus for the next run
      // against this same long-lived dev server — wait for other's own idle
      // broadcast first, but bounded (see spec/concurrent-edits.test.ts).
      const otherSawIdle = untilStatus(other, "idle");
      sender.emit("room:reset");
      await withTimeout(otherSawIdle, 5000, "room to confirm reset").catch(() => {});
      sender.close();
      other.close();
    }
  },
  20000,
);

// Extending a block that's still actively running must add time onto the
// existing end time, not restart the clock the way beginFocus would — see
// the comment on extendFocus in src/rooms.ts for why resetting
// phase_started_at mid-focus would silently undercount already-elapsed
// minutes. This proves the in-place extension end-to-end: the new end time
// is the original plus the extend amount, never just the extend amount on
// its own, and the block never leaves "focus" status.
it(
  "extends a running focus block in place, adding time rather than restarting the clock",
  async () => {
    const slug = "menzies-l1";
    const starterCookie = await registerAndGetCookie(`extend-starter-${randomUUID().slice(0, 8)}`);
    const extenderCookie = await registerAndGetCookie(`extend-other-${randomUUID().slice(0, 8)}`);

    const starter = connect(starterCookie);
    const extender = connect(extenderCookie);
    try {
      await Promise.all([once(starter, "connect"), once(extender, "connect")]);

      starter.emit("room:join", { slug });
      await once(starter, "room:update");
      extender.emit("room:join", { slug });
      await once(extender, "room:update");

      const starterFocus = untilStatus(starter, "focus");
      starter.emit("room:start-focus", { minutes: 15 });
      const { timer: original } = await withTimeout(starterFocus, 10000, "starter to see focus status");
      await withTimeout(once(extender, "room:update"), 10000, "extender to see focus update");

      expect(original.status).toBe("focus");
      expect(original.phaseEndAt).not.toBeNull();
      expect(original.durationMs).not.toBeNull();

      const extenderUpdate = once<{ timer: TimerPayload }>(extender, "room:update");
      extender.emit("room:extend", { minutes: 25 });
      const { timer: extended } = await withTimeout(extenderUpdate, 10000, "extended timer to broadcast");

      expect(extended.status).toBe("focus");
      expect(extended.phaseEndAt).toBe(original.phaseEndAt! + 25 * 60_000);
      expect(extended.durationMs).toBe(original.durationMs! + 25 * 60_000);
      expect(extended.startedByUsername).toMatch(/^extend-other-/);
    } finally {
      // extendFocus reassigns started_by to the extender (asserted above via
      // startedByUsername), so extender is who resetRoom's owner check expects
      // — but closing it immediately after emit() can still drop the reset
      // packet before it flushes, so wait for starter's own idle broadcast
      // first, bounded (see spec/concurrent-edits.test.ts).
      const starterSawIdle = untilStatus(starter, "idle");
      extender.emit("room:reset");
      await withTimeout(starterSawIdle, 5000, "room to confirm reset").catch(() => {});
      starter.close();
      extender.close();
    }
  },
  20000,
);
