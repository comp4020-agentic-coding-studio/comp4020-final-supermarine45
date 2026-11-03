// The redesigned LandingPage renders building-level cards only; a building's
// rooms live one level down on /building/:buildingSlug, and a room's own mode
// picker stays at /room/:slug. This scenario drives a real browser: the
// kicker text, all 8 building cards, live occupant count via lobby:update on
// the building card, and click-through from / -> /building/:slug -> /room/:slug.
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once } = require("../lib/api.cjs");
const { chromium } = require("../lib/pw.cjs");

module.exports = async function run(server) {
  const { baseUrl } = server;
  const { scenario, results } = makeSuite("landing-page");
  const slug = "menzies"; // dedicated to this file — see e2e/README.md's slug table
  const buildingSlug = "menzies-library"; // menzies' parent building; owned fully by this file too
  const mode = "silent";

  const browser = await chromium.launch();
  try {
    await scenario("shows a quiet kicker and all 8 seeded building cards when nobody is at a table", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(baseUrl);
        await page.waitForSelector("a[href^='/building/']");
        const kicker = await page.textContent("p.font-mono");
        ok(/Quiet on campus right now|here now/.test(kicker ?? ""), `kicker should describe current occupancy, got: ${kicker}`);
        const headings = await page.$$eval("h2", (els) => els.map((e) => e.textContent));
        equal(headings.length, 8, `expected exactly 8 building headings, got ${headings.length}`);
      } finally {
        await page.close();
      }
    });

    await scenario("building card's occupant count updates live over lobby:update when a user boards a ticket", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(baseUrl);
        const link = page.locator(`a[href='/building/${buildingSlug}']`);
        await link.waitFor();
        const before = await link.textContent();
        ok(/0 here/.test(before ?? ""), `expected the ${buildingSlug} card to start at 0 here, got: ${before}`);

        const user = await registerUniqueUser(baseUrl, "landing-a");
        const sock = connectSocket(baseUrl, user.cookie);
        try {
          await once(sock, "connect");
          sock.emit("room:join", { slug, mode });
          await once(sock, "room:joined");

          await withTimeout(
            page.waitForFunction(
              (href) => {
                const el = document.querySelector(`a[href='${href}']`);
                return !!el && /1 here/.test(el.textContent || "");
              },
              `/building/${buildingSlug}`,
              { timeout: 5000 },
            ),
            6000,
            "landing page building card to reflect the new occupant via lobby:update",
          );
        } finally {
          sock.disconnect();
        }
      } finally {
        await page.close();
      }
    });

    await scenario("clicking a building card reaches its rooms, and a room link reaches its mode picker", async () => {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err));
      try {
        await page.goto(baseUrl);

        const buildingLink = page.locator(`a[href='/building/${buildingSlug}']`);
        await buildingLink.waitFor();
        await buildingLink.click();
        await page.waitForURL(`${baseUrl}/building/${buildingSlug}`);
        equal(new URL(page.url()).pathname, `/building/${buildingSlug}`, "navigation should land on the building's room list");

        const roomLink = page.locator(`a[href='/room/${slug}']`);
        await roomLink.waitFor();
        await roomLink.click();
        await page.waitForURL(`${baseUrl}/room/${slug}`);
        equal(new URL(page.url()).pathname, `/room/${slug}`, "navigation should land on the hub's mode-picker page");

        equal(pageErrors.length, 0, `expected no uncaught page errors during navigation, got: ${pageErrors.map(String).join("; ")}`);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }

  return results;
};
