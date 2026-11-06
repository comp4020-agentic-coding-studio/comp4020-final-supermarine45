// Auto-join (see e2e/README.md's "Buildings-overview landing page... and
// auto-join" plan item): a client-only, session-scoped toggle in TablePage
// that re-boards the same ticket body on every break -> idle transition,
// until stopped. This drives the real browser toggle with Playwright (the
// actual claim to prove is that the UI's "Start auto-join" control keeps
// firing across a cycle it never manually touches, not just that an idle
// table accepts a ticket submission — a raw socket test could only prove the
// latter, already covered incidentally by core-loop.cjs's initial board). A
// second, plain socket connection for the same user observes room:update
// independently, the same pattern every other scenario file uses, so the
// assertions don't depend on reading timer state back out of the DOM.
// Honest limitation (see e2e/README.md's Item 3 test plan): this proves the
// toggle re-fires unattended at least once; it does not re-exercise "stop"
// over a further cycle (the UI reverting immediately is cheap to check here,
// but confirming a stop permanently prevents the next board is left to the
// plan's manual smoke-test checklist, to keep this scenario's runtime to one
// extra cycle rather than two).
const { makeSuite, ok, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, untilTicketCount } = require("../lib/api.cjs");
const { chromium } = require("../lib/pw.cjs");

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("auto-join");
  const slug = "chifley-ground"; // claimed by core-loop.cjs for writing/silent only — problem is free, see e2e/README.md
  const mode = "problem";

  const browser = await chromium.launch();
  try {
    await scenario("the auto-join toggle boards a new ticket on an unattended break -> idle -> focus transition", async () => {
      const user = await registerUniqueUser(baseUrl, "auto-join");
      const observer = connectSocket(baseUrl, user.cookie);
      // This scenario holds the table across two full focus blocks — long
      // enough for the server's own check-in pings to reach the observer
      // socket (see spec/tab-telemetry.test.ts). Answering them honestly
      // here keeps this test about the auto-join toggle, not the unrelated
      // check-in demotion path — same pattern as spec/kudos-and-stamp.test.ts.
      // The real browser page answers its own ping via CheckInModal's "I'm
      // here" button, handled below once it appears.
      observer.on("room:checkin-request", () => observer.emit("room:checkin-confirm"));
      // Register this listener synchronously, right after connectSocket(),
      // not after the page/cookie setup below — those are two slow `await`s,
      // and if "connect" fires while they're in flight, a once() attached
      // only afterward misses it forever (EventEmitter "once" only catches
      // events emitted after it's registered). Every other scenario file
      // connects+once()s back-to-back with no intervening await for exactly
      // this reason; this file originally didn't, and hung indefinitely.
      const observerConnected = once(observer, "connect");
      const page = await browser.newPage();
      try {
        // registerUniqueUser's cookie comes from a plain Node fetch, which
        // Playwright's browser context knows nothing about — without this,
        // the page loads as an anonymous Shadow (no sid cookie on the socket
        // handshake), TicketForm never renders, and #ticket-body waits
        // forever. The other Playwright file (landing-page.cjs) never hits
        // this because it only ever uses real sockets for identity and the
        // browser purely as a passive, logged-out viewer.
        const eqIdx = user.cookie.indexOf("=");
        await page.context().addCookies([
          { name: user.cookie.slice(0, eqIdx), value: user.cookie.slice(eqIdx + 1), url: baseUrl },
        ]);

        await observerConnected;
        // room:update is scoped to a Socket.IO room joined inside the
        // server's room:join handler, per-socket — so this independent
        // observer socket (same user, second connection) must join it too,
        // exactly like every non-Playwright scenario's sockets do, or it
        // never receives a single room:update broadcast.
        observer.emit("room:join", { slug, mode });
        await once(observer, "room:joined");

        await page.goto(`${baseUrl}/room/${slug}/${mode}`);

        // This test spans two full focus blocks, so the browser's own
        // socket (managed internally by useTableSocket.ts, not controllable
        // from here) will get check-in pings like any other live Active
        // user. Answer them by clicking CheckInModal's "I'm here (Ns)"
        // button whenever it's up — a background poll rather than a single
        // wait, since the modal can appear at either of the two per-block
        // offsets and this loop must outlive both blocks. Matching on
        // "here" alone stays robust to the changing countdown suffix.
        let watchingCheckIn = true;
        const checkInWatcher = (async () => {
          while (watchingCheckIn) {
            try {
              const btn = page.locator("button:has-text('here')");
              if ((await btn.count()) > 0 && (await btn.first().isVisible())) {
                await btn.first().click();
              }
            } catch {
              // Page mid-navigation or closed between polls — retry next tick.
            }
            await page.waitForTimeout(500);
          }
        })();

        await page.fill("#ticket-body", "Scope the next problem");
        await page.click("button:has-text('Board this table')");

        await withTimeout(untilTicketCount(observer, 1), 5000, "observer to see the initial ticket land");

        // Wait for the first focus block to actually start before enabling
        // auto-join. handleEnableAutoJoin immediately re-submits autoJoinBody
        // if the table is still idle at the moment it's switched on (the
        // plan's deliberate "immediate board on enable" behavior) — and
        // submitTicket is an upsert keyed by (user, cycle), so enabling it in
        // the same idle window as the manual board above would silently
        // overwrite "Scope the next problem" with the auto-join body before
        // the first cycle even started, instead of the two bodies landing in
        // two genuinely separate cycles like this scenario means to prove.
        await withTimeout(untilStatus(observer, "focus"), cycleMs + 10000, "table to reach focus after the first board");

        const autoJoinBody = "Keep chipping at the backlog";
        await page.fill("form:has-text('Auto-join the next session') input", autoJoinBody);
        await page.click("button:has-text('Start auto-join')");
        await page.waitForSelector("text=Auto-join on");

        const firstBreak = await withTimeout(untilStatus(observer, "break"), cycleMs + 10000, "table to reach break");
        ok(
          firstBreak.tickets.some((t) => t.username === user.username && t.body === "Scope the next problem"),
          "the manually-boarded ticket should still be present going into the first break",
        );

        await withTimeout(untilStatus(observer, "idle"), cycleMs + 10000, "table to return to idle after the first break");

        const secondFocus = await withTimeout(
          untilStatus(observer, "focus"),
          cycleMs + 10000,
          "table to reach a second focus block with no further action taken",
        );
        ok(
          secondFocus.tickets.some((t) => t.username === user.username && t.body === autoJoinBody),
          `expected a ticket with the auto-join body to have boarded unattended, got bodies: ${secondFocus.tickets.map((t) => t.body).join(", ")}`,
        );

        await page.click("button:has-text('Stop')");
        await page.waitForSelector("button:has-text('Start auto-join')");

        watchingCheckIn = false;
        await checkInWatcher;
      } finally {
        watchingCheckIn = false;
        await page.close();
        observer.disconnect();
      }
    });
  } finally {
    await browser.close();
  }

  return results;
};
