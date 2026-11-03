// Thin HTTP + socket helpers for talking to a running instance, mirroring
// the conventions already established in spec/*.test.ts (registerAndGetCookie,
// connect, once, withTimeout-wrapped pollers) so anyone who's read the spec
// suite recognizes these immediately. Kept separate from spec/ itself since
// that directory is Vitest-only (vitest.config.ts's include glob) and these
// scripts run as plain Node processes against a throwaway server instance
// (see e2e/lib/server.cjs) instead.
const { io } = require("socket.io-client");

let uidCounter = 0;
function uniqueSuffix() {
  uidCounter += 1;
  return `${Date.now().toString(36)}${uidCounter}`;
}

async function registerAndGetCookie(baseUrl, username, password = "password123") {
  const res = await fetch(new URL("/auth/register", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@anu.edu.au`, password }),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`register ${username} failed (${res.status}): ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`register ${username} returned no set-cookie header`);
  return { cookie: setCookie.split(";")[0], username: body.username };
}

async function registerUniqueUser(baseUrl, prefix = "e2e") {
  const username = `${prefix}-${uniqueSuffix()}`;
  return registerAndGetCookie(baseUrl, username);
}

async function login(baseUrl, username, password) {
  const res = await fetch(new URL("/auth/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body, cookie: setCookie ? setCookie.split(";")[0] : null };
}

async function createGuestCookie(baseUrl) {
  const res = await fetch(new URL("/auth/guest", baseUrl), { method: "POST" });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`guest create failed (${res.status}): ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("guest create returned no set-cookie header");
  return { cookie: setCookie.split(";")[0], username: body.username };
}

async function getMe(baseUrl, cookie) {
  const res = await fetch(new URL("/api/me", baseUrl), { headers: cookie ? { cookie } : {} });
  return res.json();
}

async function getLocations(baseUrl) {
  const res = await fetch(new URL("/api/locations", baseUrl));
  return res.json();
}

async function getConfig(baseUrl) {
  const res = await fetch(new URL("/api/config", baseUrl));
  return res.json();
}

function connectSocket(baseUrl, cookie) {
  return io(baseUrl, { extraHeaders: cookie ? { cookie } : {}, transports: ["websocket"] });
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function untilRoomUpdate(socket, predicate) {
  return new Promise((resolve) => {
    function handler(payload) {
      if (predicate(payload)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    }
    socket.on("room:update", handler);
  });
}

function untilStatus(socket, status) {
  return untilRoomUpdate(socket, (p) => p.timer.status === status);
}

function untilSubphase(socket, subphase) {
  return untilRoomUpdate(socket, (p) => p.timer.status === "focus" && p.timer.subphase === subphase);
}

function untilTicketCount(socket, count) {
  return untilRoomUpdate(socket, (p) => p.tickets.length === count);
}

function untilTicketStuck(socket, userId, stuck) {
  return untilRoomUpdate(socket, (p) => {
    const t = p.tickets.find((t) => t.userId === userId);
    return !!t && t.stuck === stuck;
  });
}

module.exports = {
  registerAndGetCookie,
  registerUniqueUser,
  login,
  createGuestCookie,
  getMe,
  getLocations,
  getConfig,
  connectSocket,
  once,
  untilRoomUpdate,
  untilStatus,
  untilSubphase,
  untilTicketCount,
  untilTicketStuck,
  uniqueSuffix,
};
