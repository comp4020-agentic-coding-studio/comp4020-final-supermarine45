// Minimal assertion helpers so scenario scripts don't need a test framework
// dependency. Each scenario script collects {name, pass, detail} results and
// the runner (e2e/run.cjs) tallies them — see e2e/README.md.
class AssertionError extends Error {}

function ok(cond, message) {
  if (!cond) throw new AssertionError(message || "expected truthy value");
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new AssertionError(`${message || "values differ"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function match(actual, re, message) {
  if (!re.test(actual)) {
    throw new AssertionError(`${message || "pattern mismatch"}: ${JSON.stringify(actual)} did not match ${re}`);
  }
}

// A tiny scenario runner: each case is an async fn; failures are caught and
// recorded rather than throwing, so one broken case doesn't abort the file.
function makeSuite(fileLabel) {
  const results = [];
  async function scenario(name, fn) {
    const startedAt = Date.now();
    try {
      await fn();
      results.push({ file: fileLabel, name, pass: true, ms: Date.now() - startedAt });
      console.log(`  ok   ${name} (${Date.now() - startedAt}ms)`);
    } catch (err) {
      results.push({ file: fileLabel, name, pass: false, ms: Date.now() - startedAt, detail: err.stack || String(err) });
      console.log(`  FAIL ${name}`);
      console.log(
        String(err.stack || err)
          .split("\n")
          .map((l) => `       ${l}`)
          .join("\n"),
      );
    }
  }
  return { scenario, results };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AssertionError(`timed out after ${ms}ms waiting for: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { ok, equal, match, makeSuite, withTimeout, AssertionError };
