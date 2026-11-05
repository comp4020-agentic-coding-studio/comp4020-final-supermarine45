# e2e/ — end-to-end scenario suite

This is a second test suite alongside `spec/` (Vitest). It exists because
`spec/` is scoped by `vitest.config.ts` to `spec/**/*.test.ts` and talks only
to HTTP/sockets — nothing in this repo's existing test setup drives a real
browser, and no single `spec/` file walks the *entire* Table loop
(hub → mode pick → ticket → Solo Gate → Collab → Break's 3 cards → VFH) with
more than one concurrent user end to end. `e2e/` fills both gaps. It does not
replace or duplicate `spec/` — see "Division of labour" below.

## Running it

```sh
node e2e/run.cjs            # every scenario file in e2e/scenarios/
node e2e/run.cjs capacity   # only files whose name matches "capacity"
```

No build step, no test framework dependency, no flags. Each run:
1. Spawns a fresh `tsx src/server.ts` on a free port, with its own throwaway
   SQLite file in a temp directory (`e2e/lib/server.cjs`).
2. Runs every `e2e/scenarios/*.cjs` file against it in sequence.
3. Prints a pass/fail tally and exits non-zero on any failure.
4. Tears the server down, always (even if a scenario throws).

If a scenario fails, the printed stack trace includes the assertion detail;
the isolated server's own stdout/stderr is saved to a temp file whose path is
printed at startup (`Server log: ...`), useful if a scenario times out with no
clear assertion failure (usually means the server never reached the expected
state at all, not that it reached a *wrong* one).

## Why it's never run by `pnpm test` / CI

`vitest.config.ts` only includes `spec/**/*.test.ts`, and the root
`tsconfig.json` only covers `*.ts`, `spec`, and `scripts` — `e2e/` is outside
both on purpose. These scripts spawn a real server process and, for the
landing-page scenario, a real Chromium browser; that's a much heavier and
slower dependency than anything CI currently installs (see `Dockerfile` and
`.github/workflows/checks.yml`, neither of which touch Playwright). Keeping
`e2e/` out of the typecheck/CI path means it can use Playwright and plain
Node scripts freely without adding either as a project dependency or slowing
down the checks every PR already runs.

## Why `.cjs`, not `.js` or `.mjs`

Root `package.json` sets `"type": "module"`, so a plain `.js` file here would
be parsed as ESM, where `require()` isn't a function. The Playwright loader
(`lib/pw.cjs`) specifically needs `require()`'s try/catch-based fallback
behavior (see below), so every file in `e2e/` uses the explicit `.cjs`
extension to force CommonJS regardless of the package's module type. This was
a real bug during development, not a precaution: an earlier `lib/pw.js`
worked when `require()`'d directly but threw when `import()`'d as ESM.

## Playwright without adding it as a dependency

`lib/pw.cjs` tries `require("playwright")` first (works if you've
`pnpm add -D`'d it locally), and falls back to a cached `npx` install if not.
Only `scenarios/landing-page.cjs` needs this — everything else is plain
HTTP/socket traffic with zero browser dependency. If both the bare require
and the npx-cache fallback fail on your machine, `lib/pw.cjs`'s thrown error
message tells you the exact fix (`npx playwright@1.64.1 install chromium`, or
installing it as a real dependency).

## Division of labour with `spec/`

`spec/*.test.ts` is Vitest and already covers a long list of specific
invariants (concurrency races, reconnect sync, tab-hidden telemetry, kudos,
presence counts, logging — see `spec/README.md`). `e2e/` is deliberately not
trying to re-prove those. Instead it covers:

- The **full table loop** end to end with 2 concurrent real users in one
  scenario (`core-loop.cjs`) — `spec/` has plenty of pieces of this but no
  single file walks all of hub→ticket→focus→solo→collab→break→stamp→kudos→VFH
  in one go.
- The **Stuck flag** (`stuck-flag.cjs`) — not covered anywhere in `spec/`.
- The **6-seat table cap**, including the édge case that editing your own
  already-boarded ticket must never count as a 7th boarder (`capacity.cjs`).
- **Shadow/anonymous enforcement** across all four mutating events in one
  file (`shadow.cjs`) — `spec/shadow-view.test.ts` covers one rejection path;
  this covers all four plus confirms no side effect leaks through.
- **Auth HTTP flows** — register validation (every error string), login,
  guest, logout (`auth.cjs`) — `spec/` exercises auth only incidentally, as a
  means of getting a cookie for socket tests.
- The **Strava-style profile**: VFH, heatmap, Cognitive Diet, Hub Stats, and
  the full Buddy request → accept → feed loop (`account.cjs`) — none of this
  (the single largest net-new feature in the redesign) has any `spec/`
  coverage at all.
- The **guided pod loop composed end to end** (`reboard-streak.cjs`): two
  users converge on the same (purely cosmetic, non-gating) Leader, then each
  completes a cycle, reboards, and sees their own persisted streak increment
  — no vote, no quorum, no leader action involved — `spec/leader-crowning.test.ts`
  and `spec/reboard-streak.test.ts` already cover each mechanic (leader
  determinism, individual streak increment/reset) in isolation; this proves
  they compose across one real table's whole cycle.
- The **redesigned landing page** (buildings overview, click-through to a
  building's rooms), in a real browser via Playwright (`landing-page.cjs`) —
  `spec/` never executes client JS or renders markup except for `/readme/`'s
  server-rendered heading check.
- **Auto-join** (`auto-join.cjs`): the client-only "re-board the same ticket
  every cycle until stopped" toggle, driven through the real browser control
  across an unattended break → idle → focus transition — `spec/` has no
  client UI harness at all, and the underlying idle-boarding primitive it
  relies on is otherwise only exercised incidentally (e.g. `core-loop.cjs`'s
  initial board).

## Location-slug conventions

Both suites run against the same 26 seeded ANU locations, and a table is
keyed by `(location, mode)` — so two suites (or two scenario files) touching
the same `(slug, mode)` pair around the same time can board tickets onto the
same table and confuse each other's assertions. `spec/*.test.ts` claims 20 of
the 26 seeded slugs (confirmed by grep, not guesswork); the 6 left completely
unclaimed are split one-per-file here so no two `e2e/scenarios/*.cjs` files
can ever collide with each other either, even if a future change makes them
run concurrently instead of sequentially:

| Slug | Used by |
|---|---|
| `chifley-ground` | `core-loop.cjs` (writing/silent), `auto-join.cjs` (problem) |
| `hancock-ground` | `capacity.cjs` |
| `law` | `stuck-flag.cjs` (problem/silent/pitch), `reboard-streak.cjs` (writing) |
| `menzies` | `landing-page.cjs` (also fully owns the `menzies-library` building slug) |
| `chifley` | `shadow.cjs` |
| `hancock` | `account.cjs` |

`auth.cjs` never joins a table at all, so it doesn't need a slug. `law` and
`chifley-ground` are the two slugs shared across two files each — safe only
because each pair claims disjoint modes (`stuck-flag.cjs`'s problem/silent/pitch
vs. `reboard-streak.cjs`'s writing; `core-loop.cjs`'s writing/silent vs.
`auto-join.cjs`'s problem), and tables are keyed by `(location, mode)` jointly.

Each `e2e/run.cjs` invocation gets its own throwaway server/database anyway
(`lib/server.cjs`), so this table only matters if you ever point a scenario
file at a long-lived shared server (e.g. your own `pnpm dev` instance)
instead of the isolated one `run.cjs` spins up by default.

## Test-speed timing

`lib/server.cjs` starts the server with `TABLE_CYCLE_MS=18000`,
`CHECKIN_GRACE_MS=8000`, and `CYCLE_START_GRANULARITY_MS=18000` by
default — the same values `.github/workflows/checks.yml` uses for the
Docker-built app in CI (15s focus / 3s break at the fixed 50:10 split; 8s
check-in grace leaves 7s of focus still running afterward). `CYCLE_START_GRANULARITY_MS`
is pinned to `cycleMs` rather than left at production's real 5-minute default,
since a `cycleMs + 10000` timeout budget only holds if an idle table's
worst-case wait is itself bounded by `cycleMs`. Scenario files should never
invent their own timing constants — read `server.cycleMs`/`server.checkinGraceMs`
from the object `run(server)` receives, and size `withTimeout` budgets off
those (typically `cycleMs + 10000` for "wait for the next phase transition",
generous enough to absorb scheduling jitter without the suite becoming flaky).

## Writing a new scenario file

Every file in `e2e/scenarios/` follows the same shape:

```js
const { makeSuite, ok, equal, withTimeout } = require("../lib/assert.cjs");
const { registerUniqueUser, connectSocket, once /* ... */ } = require("../lib/api.cjs");

module.exports = async function run(server) {
  const { baseUrl, cycleMs } = server;
  const { scenario, results } = makeSuite("my-file-label");

  await scenario("describes exactly one thing being proven", async () => {
    // ... register users, connect sockets, emit, assert ...
  });

  return results;
};
```

`e2e/run.cjs` auto-discovers every `*.cjs` file in `scenarios/` — just add
the file and it runs on the next invocation, no registration step. Pick an
unclaimed slug (or a fresh one not in the table above) if the scenario boards
any tickets.
