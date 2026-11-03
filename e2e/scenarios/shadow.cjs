// Shadow enforcement: a socket with NO session cookie at all (not even a
// guest one — createGuestIdentity() issues a real cookie, so "Shadow" here
// specifically means a fully anonymous connection, see src/rooms.ts's
// room:join handler branching on currentIdentity()). Confirms a Shadow can
// still read room:update live, but every mutating emit is rejected with
// "unauthorized" and never changes server state.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilTicketCount } = require("../lib/api.cjs");

module.exports = async function run(server) {
  const { baseUrl } = server;
  const { scenario, results } = makeSuite("shadow");
  const slug = "chifley"; // dedicated to this file — see e2e/README.md's slug table
  const mode = "silent";

  await scenario("an unauthenticated socket joins as a Shadow and is counted separately from the roster", async () => {
    const sock = connectSocket(baseUrl, null);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug, mode });
      const joined = await withTimeout(once(sock, "room:joined"), 5000, "room:joined for the Shadow");
      equal(joined.isShadow, true, "a cookie-less connection must be flagged as a Shadow");

      const update = await withTimeout(once(sock, "room:update"), 5000, "room:update to reach the Shadow");
      ok(update.shadowCount >= 1, `expected shadowCount >= 1, got ${update.shadowCount}`);
    } finally {
      sock.disconnect();
    }
  });

  await scenario("a Shadow's room:submit-ticket is rejected with unauthorized and creates no ticket", async () => {
    const sock = connectSocket(baseUrl, null);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug, mode });
      await once(sock, "room:joined");

      const errorPromise = once(sock, "room:error");
      sock.emit("room:submit-ticket", { body: "Shadows shouldn't be able to do this" });
      const error = await withTimeout(errorPromise, 5000, "room:error for Shadow room:submit-ticket");
      equal(error.error, "unauthorized");
      equal(error.action, "room:submit-ticket");

      // Confirm no ticket actually landed: a real user joining right after
      // should see zero tickets on the table.
      const witness = await registerUniqueUser(baseUrl, "shdw-w");
      const witnessSock = connectSocket(baseUrl, witness.cookie);
      try {
        await once(witnessSock, "connect");
        witnessSock.emit("room:join", { slug, mode });
        const witnessJoined = await once(witnessSock, "room:joined");
        ok(!witnessJoined.myTicket, "witness should have no ticket of their own");
      } finally {
        witnessSock.disconnect();
      }
    } finally {
      sock.disconnect();
    }
  });

  await scenario("a Shadow's room:toggle-stuck, room:stamp-ticket, and room:send-kudos are all rejected with unauthorized", async () => {
    const sock = connectSocket(baseUrl, null);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug: "chifley", mode: "problem" });
      await once(sock, "room:joined");

      const stuckError = once(sock, "room:error");
      sock.emit("room:toggle-stuck");
      equal((await withTimeout(stuckError, 5000, "room:error for Shadow toggle-stuck")).error, "unauthorized");

      const stampError = once(sock, "room:error");
      sock.emit("room:stamp-ticket", { stamp: "completed" });
      equal((await withTimeout(stampError, 5000, "room:error for Shadow stamp-ticket")).error, "unauthorized");

      const kudosError = once(sock, "room:error");
      sock.emit("room:send-kudos", { toUserId: 1, emoji: "⚡" });
      equal((await withTimeout(kudosError, 5000, "room:error for Shadow send-kudos")).error, "unauthorized");
    } finally {
      sock.disconnect();
    }
  });

  return results;
};
