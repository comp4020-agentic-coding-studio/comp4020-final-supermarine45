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

type RoomUpdate = { roster: { username: string }[]; shadowCount: number; tickets: { username: string }[] };

// A slug not used by any other spec file.
const slug = "hancock-l1";
const mode = "silent";

// Shadows (unauthenticated sockets) never enter `presence`, so they're
// invisible to roster()/occupancy() by design (see shadow-view.test.ts) —
// this proves the separate shadowCount field is what actually makes them
// countable, without ever leaking into the roster or occupant headcount.
it("tracks unauthenticated Shadow viewers in shadowCount, separately from the roster", async () => {
  const residentCookie = await registerAndGetCookie(`resident-${randomUUID().slice(0, 8)}`);
  const resident = connect(residentCookie);
  try {
    await once(resident, "connect");
    resident.emit("room:join", { slug, mode });
    await once(resident, "room:joined");
    const initial = await once<RoomUpdate>(resident, "room:update");
    expect(initial.shadowCount).toBe(0);
    expect(initial.roster).toHaveLength(1);

    const shadow = connect();
    try {
      await once(shadow, "connect");

      // Registered before the shadow's own join emit so there's no gap in
      // which the resident's next room:update could be missed.
      const sawShadowJoin = once<RoomUpdate>(resident, "room:update");
      shadow.emit("room:join", { slug, mode });
      const afterShadowJoin = await sawShadowJoin;
      expect(afterShadowJoin.shadowCount).toBe(1);
      expect(afterShadowJoin.roster).toHaveLength(1);

      const sawShadowLeave = once<RoomUpdate>(resident, "room:update");
      shadow.close();
      const afterShadowLeave = await sawShadowLeave;
      expect(afterShadowLeave.shadowCount).toBe(0);
      expect(afterShadowLeave.roster).toHaveLength(1);
    } finally {
      shadow.close();
    }
  } finally {
    // No manual reset exists anymore (Decision 2) — just disconnect.
    resident.close();
  }
});

// Regression: roster() used to build one entry per socket.id rather than per
// person, so a user connected twice (two tabs, or — as here — a second raw
// socket alongside their main one) got two RosterEntry rows sharing a
// userId. The client renders roster entries keyed by userId
// (PresentRoster.tsx's `key={r.userId}`), which a duplicate key could break.
// roster() now de-dupes by userId before returning, so a dual-connected
// person must appear exactly once, on every broadcast.
//
// roster is a presence view, not an unboarded-only view: boarding a ticket
// does NOT remove someone from roster (confirmed by reconnect-sync.test.ts's
// own roster-length-3 assertion at the moment a ticket brings a table into
// focus) — presence and boarding are tracked and reported separately, and
// the client derives its own "present but not yet boarded" list by diffing
// roster against tickets (TablePage.tsx's unboardedRoster). So the
// after-boarding check here does two things: (1) re-proves the dedup still
// holds on a later broadcast, not just the first one after join, and (2)
// replicates the client's own unboardedRoster diff to directly protect the
// PresentRoster chip list the original bug actually struck.
const dualSlug = "hancock-l1";
const dualMode = "pitch"; // hancock-l1 has writing (leader-crowning) and silent (this file) claimed; pitch is free.

it("shows a dual-connected person exactly once in the roster, before and after boarding", async () => {
  const name = `dual-${randomUUID().slice(0, 8)}`;
  const cookie = await registerAndGetCookie(name);
  const primary = connect(cookie);
  const secondary = connect(cookie);
  try {
    await Promise.all([once(primary, "connect"), once(secondary, "connect")]);

    const primaryJoined = once(primary, "room:joined");
    primary.emit("room:join", { slug: dualSlug, mode: dualMode });
    await primaryJoined;
    // room:join's handler broadcasts unconditionally right after emitting
    // room:joined (src/rooms.ts), even with nobody else at the table yet —
    // this self-only update must be drained before arming the next `once`
    // listener below, or that listener catches this stale broadcast instead
    // of the one actually caused by secondary joining (same pattern the
    // Shadow test above already follows via its own `initial` read).
    await once<RoomUpdate>(primary, "room:update");

    const sawSecondaryJoin = once<RoomUpdate>(primary, "room:update");
    const secondaryJoined = once(secondary, "room:joined");
    secondary.emit("room:join", { slug: dualSlug, mode: dualMode });
    await secondaryJoined;
    const afterSecondaryJoin = await sawSecondaryJoin;

    expect(afterSecondaryJoin.roster.filter((r) => r.username === name)).toHaveLength(1);

    const sawBoarded = once<RoomUpdate>(primary, "room:update");
    primary.emit("room:submit-ticket", { body: "Dual-socket regression check" });
    const afterBoarded = await sawBoarded;

    expect(afterBoarded.tickets.some((t) => t.username === name)).toBe(true);
    expect(afterBoarded.roster.filter((r) => r.username === name)).toHaveLength(1);

    // The client's own unboardedRoster diff (TablePage.tsx) — this is the
    // view the original bug actually broke, since PresentRoster renders
    // exactly this filtered list keyed by userId.
    const unboarded = afterBoarded.roster.filter((r) => !afterBoarded.tickets.some((t) => t.username === r.username));
    expect(unboarded.filter((r) => r.username === name)).toHaveLength(0);
  } finally {
    primary.close();
    secondary.close();
  }
});
