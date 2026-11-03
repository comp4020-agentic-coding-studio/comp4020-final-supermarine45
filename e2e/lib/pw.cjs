// Loads Playwright without adding it as a project dependency. Falls back to
// a cached npx install if the bare `require("playwright")` doesn't resolve —
// see e2e/README.md for why, and how to repopulate the cache if it's gone.
const NPX_CACHE_PATH = "/Users/fagunawan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright";

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    try {
      return require(NPX_CACHE_PATH);
    } catch {
      throw new Error(
        "Could not load Playwright from the 'playwright' package or from the npx cache at " +
          `${NPX_CACHE_PATH}.\n` +
          "Fix: npx playwright@1.64.1 install chromium   (repopulates the cache)\n" +
          "or:  pnpm add -Dw playwright && npx playwright install chromium",
      );
    }
  }
}

module.exports = { chromium: loadPlaywright().chromium };
