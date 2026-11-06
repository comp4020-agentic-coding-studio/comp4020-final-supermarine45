// The Strava-style profile (CLAUDE.md §3): VFH count, heatmap, Cognitive
// Diet, Hub Stats, and the Buddy request/accept/feed flow. Two users
// complete one real table cycle together (so both earn a VFH on the same
// ticket cycle), then buddy up and confirm each sees the other's completed
// ticket on their feed.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, getMe, getLocations } = require("../lib/api.cjs");

async function getJson(baseUrl, path, cookie) {
  const res = await fetch(new URL(path, baseUrl), { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json() };
}

async function postJson(baseUrl, path, body, cookie) {
  const res = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("account");
  const slug = "hancock"; // dedicated to this file — see e2e/README.md's slug table
  const mode = "silent";

  await scenario("buddy request validation rejects a missing or self-targeted addresseeId", async () => {
    const a = await registerUniqueUser(baseUrl, "acct-val-a");
    const missing = await postJson(baseUrl, "/api/buddies/request", {}, a.cookie);
    equal(missing.status, 400);
    equal(missing.body.error, "addresseeId is required");

    const me = await getMe(baseUrl, a.cookie);
    const self = await postJson(baseUrl, "/api/buddies/request", { addresseeId: me.id }, a.cookie);
    equal(self.status, 400);
    equal(self.body.error, "cannot buddy yourself");
  });

  await scenario(
    "two buddied users complete a table cycle and each sees the other's completed ticket on their feed, plus VFH/heatmap/diet/hub-stats reflect it",
    async () => {
      const a = await registerUniqueUser(baseUrl, "acct-a");
      const b = await registerUniqueUser(baseUrl, "acct-b");
      const meA = await getMe(baseUrl, a.cookie);
      const meB = await getMe(baseUrl, b.cookie);

      const sockA = connectSocket(baseUrl, a.cookie);
      const sockB = connectSocket(baseUrl, b.cookie);
      // Holds both sockets through a full focus block into break — long
      // enough for the server's own check-in pings to reach them (see
      // spec/tab-telemetry.test.ts). Answering them honestly keeps this test
      // about VFH/buddy-feed, not the unrelated check-in demotion path —
      // same pattern as spec/kudos-and-stamp.test.ts.
      sockA.on("room:checkin-request", () => sockA.emit("room:checkin-confirm"));
      sockB.on("room:checkin-request", () => sockB.emit("room:checkin-confirm"));
      try {
        await Promise.all([once(sockA, "connect"), once(sockB, "connect")]);
        sockA.emit("room:join", { slug, mode });
        sockB.emit("room:join", { slug, mode });
        await Promise.all([once(sockA, "room:joined"), once(sockB, "room:joined")]);

        sockA.emit("room:submit-ticket", { body: "Read the week 8 lecture notes" });
        sockB.emit("room:submit-ticket", { body: "Summarize chapter 4" });

        await withTimeout(untilStatus(sockA, "focus"), cycleMs + 10000, "table to reach focus");
        await withTimeout(untilStatus(sockA, "break"), cycleMs + 10000, "table to reach break");

        sockA.emit("room:stamp-ticket", { stamp: "completed" });
        sockB.emit("room:stamp-ticket", { stamp: "completed" });
        await withTimeout(untilStatus(sockA, "idle"), cycleMs + 10000, "table to return to idle");
      } finally {
        sockA.disconnect();
        sockB.disconnect();
      }

      const vfhA = await getMe(baseUrl, a.cookie);
      const vfhB = await getMe(baseUrl, b.cookie);
      equal(vfhA.vfhCount, 1, "A should have earned exactly 1 VFH");
      equal(vfhB.vfhCount, 1, "B should have earned exactly 1 VFH");

      const heatmap = await getJson(baseUrl, "/api/me/heatmap?days=365", a.cookie);
      equal(heatmap.status, 200);
      const totalHeatmapCount = heatmap.body.days.reduce((sum, d) => sum + d.count, 0);
      ok(totalHeatmapCount >= 1, `expected at least one heatmap day with count >= 1, got: ${JSON.stringify(heatmap.body)}`);

      const diet = await getJson(baseUrl, "/api/me/diet", a.cookie);
      equal(diet.status, 200);
      const silentEntry = diet.body.modes.find((m) => m.mode === "silent");
      ok(!!silentEntry && silentEntry.count >= 1, `expected a silent-mode diet entry, got: ${JSON.stringify(diet.body)}`);

      const locations = await getLocations(baseUrl);
      const hubName = locations.find((l) => l.slug === slug)?.name;
      const hubStats = await getJson(baseUrl, "/api/me/hub-stats", a.cookie);
      equal(hubStats.status, 200);
      const hubEntry = hubStats.body.hubs.find((h) => h.locationName === hubName);
      ok(!!hubEntry && hubEntry.count >= 1, `expected an hub-stats entry for ${hubName}, got: ${JSON.stringify(hubStats.body)}`);

      // Buddy up, then confirm each one's feed shows the other's completed ticket.
      const request = await postJson(baseUrl, "/api/buddies/request", { addresseeId: meB.id }, a.cookie);
      equal(request.status, 201);

      const wrongAccept = await postJson(baseUrl, `/api/buddies/${meA.id + meB.id + 9999}/accept`, {}, b.cookie);
      equal(wrongAccept.status, 404, "accepting a bogus/foreign requester id should 404");
      equal(wrongAccept.body.error, "no pending request from that user");

      const accept = await postJson(baseUrl, `/api/buddies/${meA.id}/accept`, {}, b.cookie);
      equal(accept.status, 200);

      const buddiesA = await getJson(baseUrl, "/api/me/buddies", a.cookie);
      equal(buddiesA.body.buddies.length, 1, "A should have exactly one accepted buddy");
      equal(buddiesA.body.buddies[0].status, "accepted");

      const feedA = await getJson(baseUrl, "/api/me/buddy-feed", a.cookie);
      const feedHasB = feedA.body.feed.some((t) => t.username === b.username && t.stamp === "completed");
      ok(feedHasB, `A's buddy feed should include B's completed ticket, got: ${JSON.stringify(feedA.body)}`);

      const feedB = await getJson(baseUrl, "/api/me/buddy-feed", b.cookie);
      const feedHasA = feedB.body.feed.some((t) => t.username === a.username && t.stamp === "completed");
      ok(feedHasA, `B's buddy feed should include A's completed ticket, got: ${JSON.stringify(feedB.body)}`);
    },
  );

  return results;
};
