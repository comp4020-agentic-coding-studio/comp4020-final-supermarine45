// CLAUDE.md §2: "Users must type a... Deliverable Ticket to join a 'Table'
// (max 6 users)." Confirms the 6th ticket succeeds, the 7th is rejected with
// table_full, and that a user who already has a ticket for this cycle can
// still update its body without being counted as a 7th boarder.
const { makeSuite, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilTicketCount } = require("../lib/api.cjs");

module.exports = async function run(server) {
  const { baseUrl } = server;
  const { scenario, results } = makeSuite("capacity");

  await scenario("a 7th ticket is rejected with table_full once 6 users have boarded", async () => {
    const slug = "hancock-ground"; // dedicated to this file — see e2e/README.md's slug table
    const mode = "pitch";
    const users = [];
    for (let i = 0; i < 7; i++) users.push(await registerUniqueUser(baseUrl, `cap-${i}`));
    const sockets = users.map((u) => connectSocket(baseUrl, u.cookie));

    try {
      await Promise.all(sockets.map((s) => once(s, "connect")));
      for (const s of sockets) s.emit("room:join", { slug, mode });
      await Promise.all(sockets.map((s) => once(s, "room:joined")));

      // Board the first 6 sequentially (each await confirms the broadcast
      // landed) so the 7th's rejection can't be a race against a slow 6th.
      for (let i = 0; i < 6; i++) {
        const waiter = untilTicketCount(sockets[0], i + 1);
        sockets[i].emit("room:submit-ticket", { body: `Prep pitch slide ${i + 1}` });
        await withTimeout(waiter, 5000, `ticket #${i + 1} to be reflected`);
      }

      const errorPromise = once(sockets[6], "room:error");
      sockets[6].emit("room:submit-ticket", { body: "One seat too many" });
      const error = await withTimeout(errorPromise, 5000, "room:error for the 7th ticket");
      equal(error.error, "table_full", "the 7th boarder must be rejected with table_full");
      equal(error.action, "room:submit-ticket");
    } finally {
      for (const s of sockets) s.disconnect();
    }
  });

  await scenario("a user who already boarded can edit their own ticket body without taking a 7th slot", async () => {
    const slug = "hancock-ground";
    const mode = "problem"; // different mode than the test above, so it's a fresh table at the same hub
    const users = [];
    for (let i = 0; i < 6; i++) users.push(await registerUniqueUser(baseUrl, `cap-edit-${i}`));
    const sockets = users.map((u) => connectSocket(baseUrl, u.cookie));

    try {
      await Promise.all(sockets.map((s) => once(s, "connect")));
      for (const s of sockets) s.emit("room:join", { slug, mode });
      await Promise.all(sockets.map((s) => once(s, "room:joined")));

      for (let i = 0; i < 6; i++) {
        const waiter = untilTicketCount(sockets[0], i + 1);
        sockets[i].emit("room:submit-ticket", { body: `Initial ticket ${i + 1}` });
        await withTimeout(waiter, 5000, `ticket #${i + 1} to be reflected`);
      }

      // Table is full at 6. The first user edits their own ticket body —
      // must succeed (no table_full) since they're not a new boarder.
      const updated = new Promise((resolve) => {
        const handler = (p) => {
          const mine = p.tickets.find((t) => t.username === users[0].username);
          if (mine && mine.body === "Edited after boarding") {
            sockets[0].off("room:update", handler);
            resolve(p);
          }
        };
        sockets[0].on("room:update", handler);
      });
      sockets[0].emit("room:submit-ticket", { body: "Edited after boarding" });
      const result = await withTimeout(updated, 5000, "ticket edit to be accepted at full capacity");
      equal(result.tickets.length, 6, "editing an existing ticket must not change the boarded count");
    } finally {
      for (const s of sockets) s.disconnect();
    }
  });

  return results;
};
