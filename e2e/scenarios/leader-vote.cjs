// The full guided-pod loop end to end: two concurrent users board a table,
// converge on the same deterministic Leader, the Leader (and only the
// Leader) can open the Rollover Vote once break starts, and a unanimous
// passing vote increments a real persisted streak for both. spec/leader-
// crowning.test.ts and spec/rollover-vote.test.ts already cover each of
// these mechanics in isolation (quorum math, contested-vote resets, every
// rejection path) — this file's job is proving they compose correctly across
// one real table's whole cycle, the same division of labour as
// e2e/scenarios/account.cjs for VFH/heatmap/diet/hub-stats.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, untilTicketCount, untilRoomUpdate, getMe } = require("../lib/api.cjs");

function untilVoteOpened(socket) {
  return untilRoomUpdate(socket, (p) => p.voteOpenedAt !== null);
}

function untilVoteRecorded(socket, userId, vote) {
  return untilRoomUpdate(socket, (p) => {
    const t = p.tickets.find((t) => t.userId === userId);
    return !!t && t.vote === vote;
  });
}

async function getStreaks(baseUrl, cookie) {
  const res = await fetch(new URL("/api/me/streaks", baseUrl), { headers: { cookie } });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`GET /api/me/streaks failed (${res.status}): ${JSON.stringify(body)}`);
  return body.streaks;
}

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("leader-vote");
  const slug = "law"; // dedicated to stuck-flag.cjs on problem/silent/pitch — writing is free, see e2e/README.md
  const mode = "writing";

  await scenario("two users boarding back-to-back converge on the same Leader for both viewers", async () => {
    const a = await registerUniqueUser(baseUrl, "ldv-crown-a");
    const b = await registerUniqueUser(baseUrl, "ldv-crown-b");
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
    "a non-leader's room:initiate-vote is rejected, the leader's opens voting, and a unanimous yes with quorum increments both users' streaks",
    async () => {
      const a = await registerUniqueUser(baseUrl, "ldv-win-a");
      const b = await registerUniqueUser(baseUrl, "ldv-win-b");
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
        const [boarded] = await Promise.all([
          withTimeout(aSeesBoth, 10000, "a to see both boarded tickets"),
          withTimeout(bSeesBoth, 10000, "b to see both boarded tickets"),
        ]);
        const leaderUserId = boarded.leaderUserId;
        const leaderSock = leaderUserId === meA.id ? sockA : sockB;
        const nonLeaderSock = leaderUserId === meA.id ? sockB : sockA;
        const leaderCookie = leaderUserId === meA.id ? a.cookie : b.cookie;
        const nonLeaderCookie = leaderUserId === meA.id ? b.cookie : a.cookie;

        await withTimeout(untilStatus(sockA, "focus"), cycleMs + 10000, "table to reach focus");
        await withTimeout(untilStatus(sockA, "break"), cycleMs + 10000, "table to reach break");

        const rejectionPromise = once(nonLeaderSock, "room:error");
        nonLeaderSock.emit("room:initiate-vote");
        const rejection = await withTimeout(rejectionPromise, 5000, "room:error for a non-leader's initiate-vote");
        equal(rejection.error, "not_leader");
        equal(rejection.action, "room:initiate-vote");

        const bothSeeOpen = Promise.all([untilVoteOpened(sockA), untilVoteOpened(sockB)]);
        leaderSock.emit("room:initiate-vote");
        const [openedA, openedB] = await withTimeout(bothSeeOpen, 5000, "both sockets to see voteOpenedAt set");
        ok(openedA.voteOpenedAt !== null, "voteOpenedAt should be set once the leader initiates");
        equal(openedB.voteOpenedAt, openedA.voteOpenedAt, "both viewers must see the same voteOpenedAt");

        const aVoted = untilVoteRecorded(sockA, meA.id, "yes");
        const bVoted = untilVoteRecorded(sockA, meB.id, "yes");
        sockA.emit("room:cast-vote", { vote: "yes" });
        sockB.emit("room:cast-vote", { vote: "yes" });
        await withTimeout(Promise.all([aVoted, bVoted]), 5000, "both yes votes to be recorded");

        await withTimeout(untilStatus(sockA, "idle"), cycleMs + 10000, "table to resolve the vote and return to idle");

        const streaksA = await getStreaks(baseUrl, leaderCookie);
        const streaksB = await getStreaks(baseUrl, nonLeaderCookie);
        const entryA = streaksA.find((s) => s.activityMode === mode);
        const entryB = streaksB.find((s) => s.activityMode === mode);
        ok(!!entryA && entryA.currentStreak === 1, `leader should have a streak of 1, got: ${JSON.stringify(streaksA)}`);
        ok(!!entryB && entryB.currentStreak === 1, `non-leader should have a streak of 1, got: ${JSON.stringify(streaksB)}`);
      } finally {
        sockA.disconnect();
        sockB.disconnect();
      }
    },
  );

  return results;
};
