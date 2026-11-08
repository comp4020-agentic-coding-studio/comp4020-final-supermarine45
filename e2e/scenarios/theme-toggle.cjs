// Item 2 of the design-improvement plan: dark/light theme must be
// user-toggleable, reflected on <html data-theme>, and persisted across
// reloads via localStorage. Pure chrome concern, no table/socket state
// needed — just load the landing page and drive the toggle in the header.
const { makeSuite, ok, equal } = require("../lib/assert.cjs");
const { chromium } = require("../lib/pw.cjs");

module.exports = async function run(server) {
  const { baseUrl } = server;
  const { scenario, results } = makeSuite("theme-toggle");

  const browser = await chromium.launch();
  try {
    await scenario("clicking the theme toggle flips data-theme on <html>", async () => {
      // The toggle is a simple 2-way light <-> dark cycle (no "system" option
      // — see CLAUDE.md's "deliberately simple interface" rule), so a single
      // click must flip data-theme every time.
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err));
      try {
        await page.goto(baseUrl);
        // The header renders a ThemeToggle in both its narrow (sm:hidden) and
        // wide (hidden sm:block) rows for responsive layout, same pattern as
        // the hamburger button in header-responsive.cjs. `:visible` picks
        // whichever instance actually renders at this page's viewport,
        // instead of `.first()`'s DOM-order match which may be the hidden one.
        const toggle = page.locator("header button[aria-label*='theme']:visible").first();
        await toggle.waitFor();

        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        ok(before === "light" || before === "dark", `expected an initial resolved theme, got ${before}`);

        await toggle.click();
        const afterFirstClick = await page.evaluate(() => document.documentElement.dataset.theme);
        ok(afterFirstClick === "light" || afterFirstClick === "dark", `expected a resolved theme after clicking, got ${afterFirstClick}`);
        equal(afterFirstClick === before, false, "expected data-theme to flip on a single click");

        await toggle.click();
        const afterSecondClick = await page.evaluate(() => document.documentElement.dataset.theme);
        equal(afterSecondClick, before, "expected data-theme to flip back on a second click");

        equal(pageErrors.length, 0, `expected no uncaught page errors, got: ${pageErrors.map(String).join("; ")}`);
      } finally {
        await page.close();
      }
    });

    await scenario("the chosen theme persists across a reload", async () => {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err));
      try {
        await page.goto(baseUrl);
        const toggle = page.locator("header button[aria-label*='theme']:visible").first();
        await toggle.waitFor();

        await toggle.click();
        const chosen = await page.evaluate(() => document.documentElement.dataset.theme);
        const stored = await page.evaluate(() => localStorage.getItem("suar:theme"));
        ok(stored === "light" || stored === "dark", `expected a stored theme preference, got ${stored}`);

        await page.reload();
        await page.waitForSelector("header button[aria-label*='theme']:visible");
        const afterReload = await page.evaluate(() => document.documentElement.dataset.theme);
        equal(afterReload, chosen, "resolved theme should persist across a reload");

        equal(pageErrors.length, 0, `expected no uncaught page errors, got: ${pageErrors.map(String).join("; ")}`);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }

  return results;
};
