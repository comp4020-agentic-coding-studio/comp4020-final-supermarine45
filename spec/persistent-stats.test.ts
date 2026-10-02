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

// A fresh login mints a brand-new session row, distinct from the one
// registration made. Reading focusMinutesTotal back through *that* — rather
// than through the connection that earned it, which never closed — is what
// actually stands in for a stranger leaving and coming back later.
async function loginAndGetCookie(username: string, password: string): Promise<string> {
  const res = await fetch(new URL("/auth/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status, await res.text()).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

async function getMe(
  cookie: string,
): Promise<{ username: string; focusMinutesTotal: number | null; isGuest: boolean }> {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

function connect(cookie: string): Socket {
  return io(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"] });
}

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

// Same reasoning as focus-enforcement.test.ts: a room broadcasts room:update
// on every change, so filter for the status actually being waited on instead
// of trusting that the very next event is it.
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

// Drives a user through "the core thing": join a room, run a short focus
// block, bank the partial minutes with Reset. Using Reset instead of waiting
// out a full block is also what keeps this self-cleaning — the room is back
// to idle by the time this resolves, same as the fixed-slug tests elsewhere
// in this suite rely on.
async function earnSomeFocusMinutes(cookie: string, slug: string, waitMs: number): Promise<void> {
  const socket = connect(cookie);
  try {
    await once(socket, "connect");
    socket.emit("room:join", { slug });
    await once(socket, "room:update");

    socket.emit("room:start-focus", { minutes: 15 });
    await untilStatus(socket, "focus");

    await new Promise((resolve) => setTimeout(resolve, waitMs));

    socket.emit("room:reset");
    await untilStatus(socket, "idle");
  } finally {
    socket.close();
  }
}

// Crit 8's persistence spec, in this app's own terms: "a stranger can visit,
// do the core thing, and find their trace still there when they come back."
// The core thing here is a focus block; the trace is focus_minutes_total.
it("keeps a user's focus minutes on their account across a fresh login", async () => {
  const username = `returner-${randomUUID().slice(0, 8)}`;
  const password = "password123";
  const registerCookie = await registerAndGetCookie(username);

  await earnSomeFocusMinutes(registerCookie, "hancock", 1500);

  const returnCookie = await loginAndGetCookie(username, password);
  const me = await getMe(returnCookie);

  expect(me.isGuest).toBe(false);
  expect(me.focusMinutesTotal).toBeGreaterThan(0);
});

// A counter that merges everyone's time into one global total, or credits
// the wrong account, would pass the single-user test above just as easily.
// Two different users, in two different rooms, for two different elapsed
// times, is what actually rules that out.
it("tracks two different users' persisted focus minutes independently", async () => {
  const password = "password123";
  const usernameA = `usera-${randomUUID().slice(0, 8)}`;
  const usernameB = `userb-${randomUUID().slice(0, 8)}`;

  const cookieA = await registerAndGetCookie(usernameA);
  const cookieB = await registerAndGetCookie(usernameB);

  await Promise.all([
    earnSomeFocusMinutes(cookieA, "hancock", 1000),
    earnSomeFocusMinutes(cookieB, "menzies", 2500),
  ]);

  const meA = await getMe(await loginAndGetCookie(usernameA, password));
  const meB = await getMe(await loginAndGetCookie(usernameB, password));

  expect(meA.username).toBe(usernameA);
  expect(meB.username).toBe(usernameB);
  expect(meA.focusMinutesTotal).toBeGreaterThan(0);
  expect(meB.focusMinutesTotal).toBeGreaterThan(0);
  // B waited more than twice as long as A, so its trace should reflect that
  // — not just "both nonzero", which a shared or constant counter could also
  // satisfy.
  expect(meB.focusMinutesTotal!).toBeGreaterThan(meA.focusMinutesTotal!);
});
