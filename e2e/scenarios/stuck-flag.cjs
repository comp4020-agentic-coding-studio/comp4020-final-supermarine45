// The Stuck flag (CLAUDE.md §2's "rubber-duck debugging" collab phase) only
// means anything in Problem-Solving mode. Confirms it's accepted and
// broadcast live there, and rejected with wrong_mode everywhere else.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, untilRoomUpdate } = require("../lib/api.cjs");

function untilTicketStuckFor(socket, username, stuck) {
  return untilRoomUpdate(socket, (p) => {
    const t = p.tickets.find((t) => t.username === username);
    return !!t && t.stuck === stuck;
  });
}

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("stuck-flag");

  await scenario("toggling stuck is accepted in Problem-Solving mode and broadcasts live", async () => {
    const user = await registerUniqueUser(baseUrl, "stuck-a");
    const slug = "law"; // dedicated to this file — see e2e/README.md's slug table
    const mode = "problem";
    const sock = connectSocket(baseUrl, user.cookie);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug, mode });
      await once(sock, "room:joined");
      sock.emit("room:submit-ticket", { body: "Debug the off-by-one in the loop" });
      await withTimeout(untilStatus(sock, "focus"), cycleMs + 10000, "table to reach focus");

      sock.emit("room:toggle-stuck");
      const flagged = await withTimeout(untilTicketStuckFor(sock, user.username, true), 5000, "stuck flag to turn on");
      const myTicket = flagged.tickets.find((t) => t.username === user.username);
      ok(myTicket.stuck === true, "ticket should show stuck=true after toggling");

      sock.emit("room:toggle-stuck");
      const unflagged = await withTimeout(
        new Promise((resolve) => {
          const handler = (p) => {
            const t = p.tickets.find((t) => t.username === user.username);
            if (t && t.stuck === false) {
              sock.off("room:update", handler);
              resolve(p);
            }
          };
          sock.on("room:update", handler);
        }),
        5000,
        "stuck flag to turn back off",
      );
      const myTicket2 = unflagged.tickets.find((t) => t.username === user.username);
      ok(myTicket2.stuck === false, "ticket should show stuck=false after toggling again");
    } finally {
      sock.disconnect();
    }
  });

  await scenario("toggling stuck in Silent Focus mode is rejected with wrong_mode", async () => {
    const user = await registerUniqueUser(baseUrl, "stuck-b");
    const slug = "law";
    const mode = "silent";
    const sock = connectSocket(baseUrl, user.cookie);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug, mode });
      await once(sock, "room:joined");
      sock.emit("room:submit-ticket", { body: "Finish the reading for week 9" });

      const errorPromise = once(sock, "room:error");
      sock.emit("room:toggle-stuck");
      const error = await withTimeout(errorPromise, 5000, "room:error for toggle-stuck in silent mode");
      equal(error.error, "wrong_mode", "Stuck flag must be rejected outside Problem-Solving mode");
      equal(error.action, "room:toggle-stuck");
    } finally {
      sock.disconnect();
    }
  });

  await scenario("toggling stuck in Concept Pitch mode is also rejected with wrong_mode", async () => {
    const user = await registerUniqueUser(baseUrl, "stuck-c");
    const slug = "law";
    const mode = "pitch";
    const sock = connectSocket(baseUrl, user.cookie);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug, mode });
      await once(sock, "room:joined");

      const errorPromise = once(sock, "room:error");
      sock.emit("room:toggle-stuck");
      const error = await withTimeout(errorPromise, 5000, "room:error for toggle-stuck in pitch mode");
      equal(error.error, "wrong_mode");
    } finally {
      sock.disconnect();
    }
  });

  return results;
};
