import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await fetch(new URL("/auth/register", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password123" }),
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

// A room broadcasts room:update to everyone on any change, so a stray one
// from the other socket's own join can land in between an action and the
// "once" meant to observe its effect. Filter for the state actually wanted
// instead of trusting that the very next event is it.
function untilStatus(
  socket: Socket,
  status: string,
): Promise<{ timer: { status: string } }> {
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

// The room's break chat is supposed to be "strictly disabled and
// programmatically locked" while a focus block is running. The client greys
// the input out, but the contract that actually matters is server-side: a
// chat:send while status is 'focus' must not be persisted or broadcast, no
// matter what the sender's own UI does.
it("rejects chat messages while the room's focus timer is running", async () => {
  const slug = "chifley";
  const senderCookie = await registerAndGetCookie(`sender-${randomUUID().slice(0, 8)}`);
  const listenerCookie = await registerAndGetCookie(`listener-${randomUUID().slice(0, 8)}`);

  const sender = connect(senderCookie);
  const listener = connect(listenerCookie);
  try {
    await Promise.all([once(sender, "connect"), once(listener, "connect")]);

    sender.emit("room:join", { slug });
    await once(sender, "room:update");
    listener.emit("room:join", { slug });
    await once(listener, "room:update");

    sender.emit("room:start-focus");
    const started = await untilStatus(sender, "focus");
    expect(started.timer.status).toBe("focus");
    await untilStatus(listener, "focus"); // listener's copy of the same transition

    let receivedDuringFocus = false;
    listener.on("chat:message", () => {
      receivedDuringFocus = true;
    });

    sender.emit("chat:send", { body: "this should never arrive" });

    // No broadcast event to assert the absence of, so give it a beat and
    // confirm silence rather than waiting on something that won't happen.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(receivedDuringFocus).toBe(false);
  } finally {
    sender.close();
    listener.close();
  }
});
