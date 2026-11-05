#!/usr/bin/env node
// Runs every scenario file in e2e/scenarios/ against one fresh, isolated
// server instance (see e2e/lib/server.cjs), aggregates results, and exits
// non-zero on any failure. See e2e/README.md for usage.
const path = require("node:path");
const fs = require("node:fs");
const { startServer } = require("./lib/server.cjs");

const SCENARIOS_DIR = path.join(__dirname, "scenarios");

function discoverScenarios() {
  const requested = process.argv.slice(2);
  const all = fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".cjs"))
    .sort();
  if (requested.length === 0) return all;
  return all.filter((f) => requested.some((r) => f.includes(r)));
}

async function main() {
  const files = discoverScenarios();
  if (files.length === 0) {
    console.error("No scenario files matched. Looked in", SCENARIOS_DIR);
    process.exit(1);
  }

  console.log(`Starting isolated server (${files.length} scenario file(s) to run)...`);
  const server = await startServer({ label: "run" });
  console.log(
    `Server up at ${server.baseUrl} (cycleMs=${server.cycleMs}, checkinGraceMs=${server.checkinGraceMs}, cycleStartGranularityMs=${server.cycleStartGranularityMs})`,
  );
  console.log(`Server log: ${server.logPath}`);

  const allResults = [];
  try {
    for (const file of files) {
      console.log(`\n--- ${file} ---`);
      const run = require(path.join(SCENARIOS_DIR, file));
      const results = await run(server);
      allResults.push(...results);
    }
  } finally {
    await server.stop();
  }

  const passed = allResults.filter((r) => r.pass);
  const failed = allResults.filter((r) => !r.pass);

  console.log(`\n=== ${passed.length}/${allResults.length} passed ===`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`  - [${f.file}] ${f.name}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Runner crashed:", err.stack || err);
  process.exitCode = 1;
});
