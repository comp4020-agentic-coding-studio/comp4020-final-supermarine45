// The guided pod loop end to end, for the individual reboard streak: two
// concurrent users board a table, converge on the same deterministic Leader
// (a purely cosmetic/derived value now — it gates nothing), and each user's
// own reboard-and-stamp history (never a group vote or quorum) drives their
// streak. spec/leader-crowning.test.ts and spec/reboard-streak.test.ts already
// cover each of these mechanics in isolation (leader determinism, individual
// streak increment/reset) — this file's job is proving they compose
// correctly across one real table's whole cycle, the same division of labour
// as e2e/scenarios/account.cjs for VFH/heatmap/diet/hub-stats.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, untilTicketCount, getMe } = require("../lib/api.cjs");

async function getStreaks(baseUrl, cookie) {
  const res = await fetch(new URL("/api/me/streaks", baseUrl), { headers: { cookie } });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`GET /api/me/streaks failed (${res.status}): ${JSON.stringify(body)}`);
  return body.streaks;
}

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("reboard-streak");
  const slug = "law"; // dedicated to stuck-flag.cjs on problem/silent/pitch — writing is free, see e2e/README.md
  const mode = "writing";

  await scenario("two users boarding back-to-back converge on the same Leader for both viewers", async () => {
    const a = await registerUniqueUser(baseUrl, "rst-crown-a");
    const b = await registerUniqueUser(baseUrl, "rst-crown-b");
    const meA = await getMe(baseUrl, a.cookie);
    const meB = await getMe(baseUrl, b.cookie);

    const sockA = connectSocket(baseUrl, a.cookie);
    const sockB = connectSocket(baseUrl, b.cookie);
    try {
      await Promise.all([once(sockA, "connect"), once(sockB, "connect")]);
      sockA.emit("room:join", { slug, mode });
      await once(sockA, "room:joined");
      sockB.emit("room:join", { slug, mode });
      await once(sockB, "room:joined");

      const aSeesBoth = untilTicketCount(sockA, 2);
      const bSeesBoth = untilTicketCount(sockB, 2);
      // Fired back-to-back with no await between — same race shape as
      // spec/concurrent-tickets.test.ts and spec/leader-crowning.test.ts.
      sockA.emit("room:submit-ticket", { body: "Draft the methods section" });
      sockB.emit("room:submit-ticket", { body: "Draft the results section" });
      const [resultA, resultB] = await Promise.all([
        withTimeout(aSeesBoth, 10000, "a to see both boarded tickets"),
        withTimeout(bSeesBoth, 10000, "b to see both boarded tickets"),
      ]);

      ok(resultA.leaderUserId !== null, "leaderUserId should be set once a ticket is boarded");
      equal(resultA.leaderUserId, resultB.leaderUserId, "both viewers must agree on who the Leader is");
      ok([meA.id, meB.id].includes(resultA.leaderUserId), "the Leader must be one of the two boarded users");
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }
  });

  await scenario(
    "reboarding after a completed ticket increments your own streak, with no vote or leader action involved",
    async () => {
      const a = await registerUniqueUser(baseUrl, "rst-win-a");
      const b = await registerUniqueUser(baseUrl, "rst-win-b");
      const meA = await getMe(baseUrl, a.cookie);
      const meB = await getMe(baseUrl, b.cookie);

      const sockA = connectSocket(baseUrl, a.cookie);
      const sockB = connectSocket(baseUrl, b.cookie);
      try {
        await Promise.all([once(sockA, "connect"), once(sockB, "connect")]);
        sockA.emit("room:join", { slug, mode });
        await once(sockA, "room:joined");
        sockB.emit("room:join", { slug, mode });
        await once(sockB, "room:joined");

        const aSeesBoth = untilTicketCount(sockA, 2);
        const bSeesBoth = untilTicketCount(sockB, 2);
        sockA.emit("room:submit-ticket", { body: "Read the week 10 paper" });
        sockB.emit("room:submit-ticket", { body: "Annotate the week 10 paper" });
        await Promise.all([
          withTimeout(aSeesBoth, 10000, "a to see both boarded tickets"),
          withTimeout(bSeesBoth, 10000, "b to see both boarded tickets"),
        ]);

        await withTimeout(untilStatus(sockA, "focus"), cycleMs + 10000, "table to reach focus");
        await withTimeout(untilStatus(sockA, "break"), cycleMs + 10000, "table to reach break");

        // Both stamp "completed" — no vote, no leader action, just each
        // user's own checkout.
        sockA.emit("room:stamp-ticket", { stamp: "completed" });
        sockB.emit("room:stamp-ticket", { stamp: "completed" });

        // Both reboard for the next cycle while still in break — this is the
        // queued-reboard flow the client uses (TablePage queues it, then
        // submits once the table actually goes idle); here we just wait for
        // idle ourselves and then submit directly, which exercises the same
        // server-side room:submit-ticket path.
        await withTimeout(untilStatus(sockA, "idle"), cycleMs + 10000, "table to resolve back to idle after cycle 1");

        const aReboarded = untilTicketCount(sockA, 2);
        const bReboarded = untilTicketCount(sockB, 2);
        sockA.emit("room:submit-ticket", { body: "Revise the methods section" });
        sockB.emit("room:submit-ticket", { body: "Revise the results section" });
        await Promise.all([
          withTimeout(aReboarded, 10000, "a to see both reboarded tickets"),
          withTimeout(bReboarded, 10000, "b to see both reboarded tickets"),
        ]);

        const streaksA = await getStreaks(baseUrl, a.cookie);
        const streaksB = await getStreaks(baseUrl, b.cookie);
        const entryA = streaksA.find((s) => s.activityMode === mode);
        const entryB = streaksB.find((s) => s.activityMode === mode);
        ok(!!entryA && entryA.currentStreak === 1, `a should have a streak of 1 after completing then reboarding, got: ${JSON.stringify(streaksA)}`);
        ok(!!entryB && entryB.currentStreak === 1, `b should have a streak of 1 after completing then reboarding, got: ${JSON.stringify(streaksB)}`);
        void meA;
        void meB;
      } finally {
        sockA.disconnect();
        sockB.disconnect();
      }
    },
  );

  return results;
};
