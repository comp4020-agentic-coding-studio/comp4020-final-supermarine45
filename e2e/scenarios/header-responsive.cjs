// Item 1 of the design-improvement plan: Header.tsx must collapse into a
// hamburger menu below the `sm` breakpoint instead of overflowing. Pure
// layout concern, no table/socket state needed — just load the landing page
// at a few viewport widths and check the chrome responds and never causes
// horizontal overflow.
const { makeSuite, ok, equal } = require("../lib/assert.cjs");
const { chromium } = require("../lib/pw.cjs");

module.exports = async function run(server) {
  const { baseUrl } = server;
  const { scenario, results } = makeSuite("header-responsive");

  const browser = await chromium.launch();
  try {
    await scenario("at a narrow viewport, the hamburger is visible and the desktop row is hidden", async () => {
      const page = await browser.newPage({ viewport: { width: 375, height: 700 } });
      try {
        await page.goto(baseUrl);
        await page.waitForSelector("header");
        const hamburger = page.locator("header button[aria-label='Open menu']");
        ok(await hamburger.isVisible(), "hamburger button should be visible at 375px wide");
      } finally {
        await page.close();
      }
    });

    await scenario("clicking the hamburger opens a dropdown panel, clicking again closes it", async () => {
      const page = await browser.newPage({ viewport: { width: 375, height: 700 } });
      try {
        await page.goto(baseUrl);
        const hamburger = page.locator("header button[aria-label='Open menu']");
        await hamburger.waitFor();
        await hamburger.click();
        const closeButton = page.locator("header button[aria-label='Close menu']");
        ok(await closeButton.isVisible(), "menu panel should be open after clicking the hamburger");
        await closeButton.click();
        const reopened = page.locator("header button[aria-label='Open menu']");
        ok(await reopened.isVisible(), "menu panel should close again after clicking the close button");
      } finally {
        await page.close();
      }
    });

    await scenario("at a wide viewport, the desktop controls row is visible and the hamburger is hidden", async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await page.goto(baseUrl);
        await page.waitForSelector("header");
        const hamburger = page.locator("header button[aria-label='Open menu']");
        ok(!(await hamburger.isVisible()), "hamburger should not be visible at 1280px wide");
      } finally {
        await page.close();
      }
    });

    for (const width of [375, 768, 1280]) {
      await scenario(`no horizontal overflow at ${width}px wide`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const pageErrors = [];
        page.on("pageerror", (err) => pageErrors.push(err));
        try {
          await page.goto(baseUrl);
          await page.waitForSelector("header");
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          ok(scrollWidth <= clientWidth, `expected no horizontal overflow at ${width}px, got scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
          equal(pageErrors.length, 0, `expected no uncaught page errors, got: ${pageErrors.map(String).join("; ")}`);
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }

  return results;
};
