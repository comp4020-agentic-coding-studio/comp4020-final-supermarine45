// Personal shorter duration at board time (see rooms.ts's
// PERSONAL_DURATION_PRESETS_MIN / personalDurationMsFor, and TicketForm.tsx's
// "Block length" preset buttons): a user may pick a shorter personal block
// (e.g. 25m) instead of the full 50m when boarding, purely as a per-ticket
// overlay. The hard constraint this scenario exists to prove is that the
// shared table clock (timer.status/phaseEndAt/durationMs) is byte-for-byte
// identical for every member regardless of what any individual boarder
// picked — a raw socket test could assert the stored personalDurationMs
// field, but only driving the real TicketForm UI with Playwright proves the
// preset buttons actually wire through end to end into that stored value
// and the personal-countdown line TableDashboard renders off of it.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once, untilStatus, untilTicketCount } = require("../lib/api.cjs");
const { chromium } = require("../lib/pw.cjs");

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("personal-duration");
  const slug = "marie-reay"; // unclaimed by any other spec/ or e2e/ file — see e2e/README.md's slug table
  const mode = "writing";

  const browser = await chromium.launch();
  try {
    await scenario(
      "a 25m personal block renders its own countdown and never changes the shared table timer a control boarder sees",
      async () => {
        const shortUser = await registerUniqueUser(baseUrl, "pd-short");
        const controlUser = await registerUniqueUser(baseUrl, "pd-control");

        // Plain-socket observer for the control user — same pattern as every
        // other scenario file, so the shared-timer assertion doesn't depend
        // on reading anything back out of the DOM.
        const controlObserver = connectSocket(baseUrl, controlUser.cookie);
        const controlConnected = once(controlObserver, "connect");

        const page = await browser.newPage();
        try {
          const eqIdx = shortUser.cookie.indexOf("=");
          await page.context().addCookies([
            { name: shortUser.cookie.slice(0, eqIdx), value: shortUser.cookie.slice(eqIdx + 1), url: baseUrl },
          ]);

          await controlConnected;
          controlObserver.emit("room:join", { slug, mode });
          await once(controlObserver, "room:joined");

          // Control boards first, with the default 50m preset left untouched,
          // so its ticket's own personalDurationMs is null — the baseline
          // every other member's shared timer must match regardless of what
          // the short-block boarder below picks.
          const controlSeesOne = untilTicketCount(controlObserver, 1);
          controlObserver.emit("room:submit-ticket", { body: "Control ticket, full block" });
          await withTimeout(controlSeesOne, 5000, "control observer to see its own ticket land");

          await page.goto(`${baseUrl}/room/${slug}/${mode}`);
          await page.fill("#ticket-body", "Draft the personal-duration section");
          await page.click("button[aria-pressed]:has-text('25m')");
          const controlSeesTwo = untilTicketCount(controlObserver, 2);
          await page.click("button:has-text('Board this table')");
          const beforeFocus = await withTimeout(controlSeesTwo, 5000, "control observer to see the short-block ticket land");

          // Table-wide timer fields must be identical for the whole table —
          // nothing about the short boarder's choice may fork them.
          ok(
            beforeFocus.timer.phaseEndAt === null && beforeFocus.timer.durationMs === null,
            "table should still be idle (not yet started) right after both tickets board",
          );

          const focusUpdate = await withTimeout(untilStatus(controlObserver, "focus"), cycleMs + 10000, "table to reach focus");
          const sharedPhaseEndAt = focusUpdate.timer.phaseEndAt;
          const sharedDurationMs = focusUpdate.timer.durationMs;
          ok(sharedPhaseEndAt !== null && sharedDurationMs !== null, "shared timer should be running once focus starts");

          // The personal-duration ticket must carry the shorter value...
          const shortTicket = focusUpdate.tickets.find((t) => t.body === "Draft the personal-duration section");
          ok(!!shortTicket, `expected the short-block ticket in room:update, got bodies: ${focusUpdate.tickets.map((t) => t.body).join(", ")}`);
          // 25 of a 50-minute focus block, scaled the same way rooms.ts's
          // personalDurationMsFor does against this server's (shortened)
          // FOCUS_DURATION_MS — i.e. exactly half of the shared focus length.
          equal(shortTicket.personalDurationMs, Math.round(focusUpdate.timer.durationMs * (25 / 50)), "short ticket's personalDurationMs should scale off the shared focus duration");

          // ...while the control ticket's shared timer fields match exactly,
          // proving the shorter personal block never forked the table clock.
          ok(
            focusUpdate.timer.phaseEndAt === sharedPhaseEndAt && focusUpdate.timer.durationMs === sharedDurationMs,
            "every member's room:update should report the identical shared phaseEndAt/durationMs",
          );
          const controlTicket = focusUpdate.tickets.find((t) => t.body === "Control ticket, full block");
          ok(!!controlTicket, "control ticket should still be present once focus starts");
          equal(controlTicket.personalDurationMs, null, "control ticket should have no personal duration override");

          // The browser's own card for the short-block boarder renders the
          // personal countdown line (TableDashboard.tsx) — proving the preset
          // picked in the UI actually reached the stored ticket and back out
          // to this user's own rendering, not just the server's state.
          await page.waitForSelector("text=/personal block: \\d+\\/\\d+m/");
        } finally {
          await page.close();
          controlObserver.disconnect();
        }
      },
    );
  } finally {
    await browser.close();
  }

  return results;
};
