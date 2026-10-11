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

type RoomUpdate = { roster: { username: string }[]; shadowCount: number };

// A slug not used by any other spec file.
const slug = "hancock-l1";

// Shadows (unauthenticated sockets) never enter `presence`, so they're
// invisible to roster()/occupancy() by design (see shadow-view.test.ts) —
// this proves the separate shadowCount field is what actually makes them
// countable, without ever leaking into the roster or occupant headcount.
it("tracks unauthenticated Shadow viewers in shadowCount, separately from the roster", async () => {
  const residentCookie = await registerAndGetCookie(`resident-${randomUUID().slice(0, 8)}`);
  const resident = connect(residentCookie);
  try {
    await once(resident, "connect");
    resident.emit("room:join", { slug });
    const initial = await once<RoomUpdate>(resident, "room:update");
    expect(initial.shadowCount).toBe(0);
    expect(initial.roster).toHaveLength(1);

    const shadow = connect();
    try {
      await once(shadow, "connect");

      // Registered before the shadow's own join emit so there's no gap in
      // which the resident's next room:update could be missed.
      const sawShadowJoin = once<RoomUpdate>(resident, "room:update");
      shadow.emit("room:join", { slug });
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
    resident.emit("room:reset");
    resident.close();
  }
});
