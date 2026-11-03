import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

function connect(cookie?: string): Socket {
  return io(baseUrl, { extraHeaders: cookie ? { cookie } : {}, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

type RosterEntry = { username: string; isGuest: boolean };

function untilRoster(socket: Socket): Promise<{ roster: RosterEntry[] }> {
  return new Promise((resolve) => socket.once("room:update", resolve));
}

// See spec/lobby-override-race.test.ts for the FIFO-lock rationale this
// withTimeout helper has nothing to do with — kept here only because several
// of this file's waits are on events a broken server could simply never send.
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

// A slug not used by any other spec file.
const slug = "hancock-l3";
const mode = "silent";

// Zero-Friction Identity: a Shadow (no cookie, no account) types a name
// instead of registering, and that name survives a full reconnect — proving
// set_pseudonym really creates a persistent session via the reused guest
// mechanism, not just an in-memory label on the live socket.
it(
  "converts a Shadow to an Active pseudonym identity that survives a reconnect",
  async () => {
    const shadow = connect();
    try {
      await once(shadow, "connect");
      shadow.emit("room:join", { slug, mode });
      await once(shadow, "room:joined");
      await once(shadow, "room:update");

      const pseudonym = `pilot-${Math.random().toString(36).slice(2, 8)}`;
      // Both listeners are attached before the emit — the server's
      // broadcastRoom() fires before it emits pseudonym:set back to this same
      // socket, so waiting for pseudonym:set first would risk missing the
      // room:update that already went out (see shadow-view.test.ts for the
      // same reasoning applied to room:join).
      const setPromise = once<{ token: string }>(shadow, "pseudonym:set");
      const rosterPromise = untilRoster(shadow);
      shadow.emit("set_pseudonym", { pseudonym });
      const [{ token }, afterConvert] = await Promise.all([
        withTimeout(setPromise, 5000, "pseudonym:set"),
        withTimeout(rosterPromise, 5000, "roster to include the new pseudonym"),
      ]);
      expect(typeof token).toBe("string");

      // The conversion itself needs no reload — the same socket's own next
      // room:update already shows it as Active, no longer a Shadow.
      expect(afterConvert.roster.some((r) => r.username === pseudonym && r.isGuest)).toBe(true);

      const adoptRes = await fetch(new URL("/auth/adopt-session", baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      expect(adoptRes.status).toBe(200);
      const setCookie = adoptRes.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      const cookie = setCookie!.split(";")[0];

      // A brand new connection, using only the adopted cookie — nothing carried
      // over from the original socket — still resolves to the same identity.
      const reconnected = connect(cookie);
      try {
        await once(reconnected, "connect");
        reconnected.emit("room:join", { slug, mode });
        await once(reconnected, "room:joined");
        const rejoined = await withTimeout(
          untilRoster(reconnected),
          5000,
          "reconnected roster to show the adopted identity",
        );
        expect(rejoined.roster.some((r) => r.username === pseudonym)).toBe(true);
      } finally {
        reconnected.close();
      }
    } finally {
      shadow.close();
    }
  },
  20000,
);

// Server-Side Authority: a Shadow that never set a pseudonym gets an
// explicit, observable rejection for a mutating action, not just silence —
// shadow-view.test.ts already covers "the room state doesn't change"; this
// covers the payload CLAUDE.md actually asks for.
it(
  "explicitly rejects a mutating action from an unauthorized Shadow socket",
  async () => {
    const shadow = connect();
    try {
      await once(shadow, "connect");
      shadow.emit("room:join", { slug, mode });
      await once(shadow, "room:joined");
      await once(shadow, "room:update");

      const rejection = once<{ error: string; action: string }>(shadow, "room:error");
      shadow.emit("room:submit-ticket", { body: "A shadow's ticket" });
      const payload = await withTimeout(rejection, 5000, "room:error");
      expect(payload).toEqual({ error: "unauthorized", action: "room:submit-ticket" });
    } finally {
      shadow.close();
    }
  },
  10000,
);
