// Spins up an isolated instance of the real app (dedicated port + throwaway
// SQLite file, short TABLE_CYCLE_MS/TAB_HIDDEN_PENALTY_MS) so e2e scenarios
// never collide with a dev server you might already have running, and never
// touch spec/'s own location-slug claims. Mirrors the command the CI
// workflow uses (.github/workflows/checks.yml), just via tsx instead of the
// built Docker image, and with test-speed env vars instead of CI's.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

const ROOT = path.resolve(__dirname, "..", "..");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`nothing answered at ${url} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

// cycleMs: how long one 50/10 table cycle takes end to end (default 18s,
// matching CI: 15s focus / 3s break at the fixed 50:10 split).
// tabPenaltyMs: how long tab-hidden takes to demote someone (default 8s).
// cycleStartGranularityMs: how often an idle table rechecks for boarders
// (default = cycleMs, not the production 5-minute default) — every scenario's
// wait-for-focus budget is sized as `cycleMs + 10000` (see README's
// "Test-speed timing"), which only holds if the worst-case idle wait is
// bounded by cycleMs itself. Left at production's real 5-minute default,
// scenarios here would have to wait out a real wall-clock 5 minutes instead
// of a test-speed cycle.
async function startServer({ cycleMs = 18000, tabPenaltyMs = 8000, cycleStartGranularityMs = cycleMs, label = "e2e" } = {}) {
  const port = await findFreePort();
  const dataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), `suar-${label}-`));
  const dbPath = path.join(dataDir, "app.db");
  const logPath = path.join(dataDir, "server.log");
  const logFd = fs.openSync(logPath, "a");

  const child = spawn(path.join(ROOT, "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      TABLE_CYCLE_MS: String(cycleMs),
      TAB_HIDDEN_PENALTY_MS: String(tabPenaltyMs),
      CYCLE_START_GRANULARITY_MS: String(cycleStartGranularityMs),
      CLIENT_DIST: path.join(ROOT, "client", "dist"),
    },
    stdio: ["ignore", logFd, logFd],
  });

  const baseUrl = `http://localhost:${port}`;
  try {
    await waitForHttp(baseUrl, 30000);
  } catch (err) {
    child.kill();
    const log = fs.readFileSync(logPath, "utf8");
    throw new Error(`${err.message}\n--- server log (${logPath}) ---\n${log}`);
  }

  return {
    baseUrl,
    port,
    cycleMs,
    tabPenaltyMs,
    cycleStartGranularityMs,
    dataDir,
    logPath,
    async stop() {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
      fs.closeSync(logFd);
    },
  };
}

module.exports = { startServer };
