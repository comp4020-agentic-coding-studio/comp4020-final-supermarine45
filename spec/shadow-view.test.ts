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

// A slug not used by any other spec file (same reasoning as
// voting-resolution.test.ts): lets this run concurrently with the rest of
// the suite against the same live server without state bleeding across files.
const slug = "law-l2";

it("lets an unauthenticated socket watch a room's live state without being able to change it", async () => {
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
    // room:update and chat:history every signed-in viewer gets. Both
    // listeners are attached before the emit's response can possibly land,
    // since the server sends chat:history first — awaiting room:update alone
    // first would risk missing chat:history before a listener existed for it.
    shadow.emit("room:join", { slug });
    const [shadowView] = await Promise.all([
      once<{ timer: { status: string } }>(shadow, "room:update"),
      once(shadow, "chat:history"),
    ]);
    expect(shadowView.timer.status).toBe("idle");

    resident.emit("room:join", { slug });
    await once(resident, "room:update");

    // Write access: a mutation from the Shadow socket is silently rejected
    // server-side, not just hidden by client UI. Prove it by having the
    // resident observe the room staying idle for a beat after the Shadow's
    // attempt, rather than trusting the absence of a response from the
    // Shadow itself.
    let sawFocus = false;
    resident.on("room:update", (payload: { timer: { status: string } }) => {
      if (payload.timer.status === "focus") sawFocus = true;
    });

    shadow.emit("room:start-focus", { minutes: 25 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sawFocus).toBe(false);

    // Confirm a real participant's own start-focus still works in the same
    // room right after — the rejection above is about the Shadow's identity,
    // not an accidental lock on the room itself.
    resident.emit("room:start-focus", { minutes: 25 });
    const started = await untilStatus(resident, "focus");
    expect(started.timer.status).toBe("focus");
  } finally {
    resident.emit("room:reset");
    shadow.close();
    resident.close();
  }
});
