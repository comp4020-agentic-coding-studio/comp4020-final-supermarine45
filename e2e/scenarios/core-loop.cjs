// The core Table loop, end to end, with two real users: board a ticket,
// wait out the scheduler into focus, cross the mode's Solo Gate -> Collab
// split, wait into break, stamp + send kudos, and confirm VFH only lands for
// the user who stayed the full block and stamped. This is the single
// scenario that exercises the most of CLAUDE.md's "Core Architecture" (§2)
// end to end, so it gets the most generous per-scenario timeout budget.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, untilSubphase, getMe } = require("../lib/api.cjs");

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("core-loop");

  await scenario("two users board a ticket, reach focus, cross into collab, and complete the break", async () => {
    const a = await registerUniqueUser(baseUrl, "core-a");
    const b = await registerUniqueUser(baseUrl, "core-b");
    const slug = "chifley-ground"; // unclaimed by spec/*.test.ts — see e2e/README.md
    const mode = "writing"; // splitMinutes: 40 of 50 -> has a real solo/collab split to observe

    const sockA = connectSocket(baseUrl, a.cookie);
    const sockB = connectSocket(baseUrl, b.cookie);
    try {
      await Promise.all([once(sockA, "connect"), once(sockB, "connect")]);
      sockA.emit("room:join", { slug, mode });
      sockB.emit("room:join", { slug, mode });
      const [joinedA, joinedB] = await Promise.all([once(sockA, "room:joined"), once(sockB, "room:joined")]);
      ok(!joinedA.isShadow, "registered user A should not be a Shadow");
      ok(!joinedB.isShadow, "registered user B should not be a Shadow");

      sockA.emit("room:submit-ticket", { body: "Draft the intro paragraph" });
      sockB.emit("room:submit-ticket", { body: "Outline section 2" });
      const afterBoth = await withTimeout(
        new Promise((resolve) => {
          const handler = (p) => {
            if (p.tickets.length === 2) {
              sockA.off("room:update", handler);
              resolve(p);
            }
          };
          sockA.on("room:update", handler);
        }),
        5000,
        "both tickets to appear on the table",
      );
      equal(afterBoth.tickets.length, 2, "table should show both boarded tickets");
      equal(afterBoth.timer.status, "idle", "table should still be idle before the scheduler fires");

      const sawFocusA = untilStatus(sockA, "focus");
      const sawFocusB = untilStatus(sockB, "focus");
      const focusA = await withTimeout(sawFocusA, cycleMs + 10000, "A to reach the focus phase");
      await withTimeout(sawFocusB, cycleMs + 10000, "B to reach the focus phase");
      equal(focusA.timer.subphase, "solo", "writing mode should start in the Solo Gate");

      const collabA = await withTimeout(untilSubphase(sockA, "collab"), cycleMs + 10000, "A to cross into Open Collab");
      equal(collabA.timer.status, "focus", "still inside the same focus block when collab opens");

      const breakA = await withTimeout(untilStatus(sockA, "break"), cycleMs + 10000, "A to reach the break phase");
      equal(breakA.tickets.length, 2, "both tickets should still be present going into break");

      sockA.emit("room:stamp-ticket", { stamp: "completed" });
      sockB.emit("room:stamp-ticket", { stamp: "partial" });
      const stamped = await withTimeout(
        new Promise((resolve) => {
          const handler = (p) => {
            const ta = p.tickets.find((t) => t.username === a.username);
            const tb = p.tickets.find((t) => t.username === b.username);
            if (ta?.stamp === "completed" && tb?.stamp === "partial") {
              sockA.off("room:update", handler);
              resolve(p);
            }
          };
          sockA.on("room:update", handler);
        }),
        5000,
        "both stamps to be reflected",
      );
      const ticketB = stamped.tickets.find((t) => t.username === b.username);

      sockA.emit("room:send-kudos", { toUserId: ticketB.userId, emoji: "⚡" });
      const kudosed = await withTimeout(
        new Promise((resolve) => {
          const handler = (p) => {
            const tb = p.tickets.find((t) => t.username === b.username);
            if (tb && tb.kudos.some((k) => k.emoji === "⚡")) {
              sockA.off("room:update", handler);
              resolve(p);
            }
          };
          sockA.on("room:update", handler);
        }),
        5000,
        "kudos to be reflected on B's ticket",
      );
      const finalTicketB = kudosed.tickets.find((t) => t.username === b.username);
      equal(finalTicketB.kudos.length, 1, "B's ticket should show exactly one kudos");

      await withTimeout(untilStatus(sockA, "idle"), cycleMs + 10000, "table to return to idle after break ends");

      const meA = await getMe(baseUrl, a.cookie);
      const meB = await getMe(baseUrl, b.cookie);
      equal(meA.vfhCount, 1, "A stayed the full block and stamped 'completed' -> 1 VFH");
      equal(meB.vfhCount, 1, "B stayed the full block and stamped 'partial' -> 1 VFH (stamp value doesn't gate VFH, only presence does)");
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }
  });

  await scenario("a ticket with no stamp at all earns zero VFH even after the cycle completes", async () => {
    const c = await registerUniqueUser(baseUrl, "core-c");
    const slug = "chifley-ground";
    const mode = "silent"; // no split — simplest possible single-phase cycle

    const sock = connectSocket(baseUrl, c.cookie);
    try {
      await once(sock, "connect");
      sock.emit("room:join", { slug, mode });
      await once(sock, "room:joined");
      sock.emit("room:submit-ticket", { body: "Read chapter 3 cover to cover" });
      await withTimeout(untilStatus(sock, "focus"), cycleMs + 10000, "C to reach focus");
      await withTimeout(untilStatus(sock, "break"), cycleMs + 10000, "C to reach break");
      // Deliberately never emits room:stamp-ticket.
      await withTimeout(untilStatus(sock, "idle"), cycleMs + 10000, "table to return to idle");

      const me = await getMe(baseUrl, c.cookie);
      equal(me.vfhCount, 0, "an unstamped ticket must not earn a VFH, per CLAUDE.md §3's 'check the 50m block AND check out'");
    } finally {
      sock.disconnect();
    }
  });

  return results;
};
