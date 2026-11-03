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

type RoomError = { error: string; action: string };
type RoomUpdate = { tickets: Array<{ username: string }> };

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

// A slug not used by any other spec file: lets this run concurrently with the
// rest of the suite against the same live server without state bleeding
// across files.
const slug = "law-l2";
const mode = "silent";

it("lets an unauthenticated socket watch a table's live state without being able to change it", async () => {
  const residentCookie = await registerAndGetCookie(`resident-${randomUUID().slice(0, 8)}`);
  // Created back-to-back, right before listening for "connect" below — doing
  // the register call in between (an HTTP round trip) left enough of a gap
  // for the Shadow socket to connect and fire "connect" before a listener
  // was attached to hear it.
  const shadow = connect();
  const resident = connect(residentCookie);
  try {
    await Promise.all([once(shadow, "connect"), once(resident, "connect")]);

    // Read access: joining with no cookie at all still gets the same
    // room:joined/room:update every signed-in viewer gets.
    shadow.emit("room:join", { slug, mode });
    const shadowJoined = await once<{ isShadow: boolean }>(shadow, "room:joined");
    expect(shadowJoined.isShadow).toBe(true);
    const shadowView = await once<{ tickets: unknown[] }>(shadow, "room:update");
    expect(Array.isArray(shadowView.tickets)).toBe(true);

    resident.emit("room:join", { slug, mode });
    await once(resident, "room:joined");
    await once(resident, "room:update");

    // Write access: a mutation from the Shadow socket is silently rejected
    // server-side, not just hidden by client UI. Prove it by having the
    // resident observe the ticket count staying unchanged for a beat after
    // the Shadow's attempt, rather than trusting the absence of a response
    // from the Shadow itself.
    let sawTicket = false;
    resident.on("room:update", (payload: RoomUpdate) => {
      if (payload.tickets.length > 0) sawTicket = true;
    });

    const shadowError = once<RoomError>(shadow, "room:error");
    shadow.emit("room:submit-ticket", { body: "A shadow's ticket" });
    expect(await shadowError).toEqual({ error: "unauthorized", action: "room:submit-ticket" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sawTicket).toBe(false);

    // Confirm a real participant's own ticket submission still works in the
    // same table right after — the rejection above is about the Shadow's
    // identity, not an accidental lock on the table itself.
    const residentBoarded = untilTicketCount(resident, 1);
    resident.emit("room:submit-ticket", { body: "A resident's real ticket" });
    const boarded = await residentBoarded;
    expect(boarded.tickets[0].username).toContain("resident-");
  } finally {
    // No manual reset exists anymore (Decision 2) — tickets for this cycle
    // simply stay until the next hourly cycle mark. Nothing to tear down.
    shadow.close();
    resident.close();
  }
});
