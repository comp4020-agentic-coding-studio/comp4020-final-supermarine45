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
    await scenario("cycling the theme toggle changes data-theme on <html>", async () => {
      // The toggle cycles light -> dark -> system -> light. Starting state is
      // "system" (no stored preference yet), which can *resolve* to the same
      // value as the next step in the cycle (e.g. system resolves to "light"
      // in a light-OS test runner, and the next step is explicit "light") —
      // so a single click isn't guaranteed to flip data-theme. Click through
      // the full 3-step cycle and assert the resolved theme changes at least
      // once, which is what the user actually sees.
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err));
      try {
        await page.goto(baseUrl);
        const toggle = page.locator("header button[aria-label*='theme']").first();
        await toggle.waitFor();

        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        ok(before === "light" || before === "dark", `expected an initial resolved theme, got ${before}`);

        let changed = false;
        for (let i = 0; i < 3; i++) {
          await toggle.click();
          const current = await page.evaluate(() => document.documentElement.dataset.theme);
          ok(current === "light" || current === "dark", `expected a resolved theme after clicking, got ${current}`);
          if (current !== before) {
            changed = true;
            break;
          }
        }
        ok(changed, "expected data-theme to change at some point across a full cycle of the toggle");

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
        const toggle = page.locator("header button[aria-label*='theme']").first();
        await toggle.waitFor();

        await toggle.click();
        const chosen = await page.evaluate(() => document.documentElement.dataset.theme);
        const stored = await page.evaluate(() => localStorage.getItem("suar:theme"));
        ok(stored === "light" || stored === "dark" || stored === "system", `expected a stored theme preference, got ${stored}`);

        await page.reload();
        await page.waitForSelector("header button[aria-label*='theme']");
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
