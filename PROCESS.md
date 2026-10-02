# Process overview

The app 'shut up and read' is based on an initiative 'shut up and write', as being done by the ANUSA (ANU Student Association). The main idea is a tool to help students find reading or studying partners, to study together. As a productivity app, the interface is deliberately made simple, with a core function to find study or reading groups across campus, along with a 'pomodoro'-style countdown timer to time the study sessions, which holds users accountable and focused on their reading. All user activities are logged in the backend to produce summary statistics.

The process begins with defining a detailed rule/guidelines in `CLAUDE.md`, as well as a comprehensive prompt covering the full build (scaffold, DB/auth, the room/timer backend, the frontend, styling, and docs). `CLAUDE.md`'s definition of "good" — real accounts, hardcoded physical locations, server-authoritative sync, and no private messaging or social-feed features — was fixed before any code was written, and the agent built against it rather than negotiating it mid-session.

## Stack decision record

The course scaffold leaves the stack open; it only fixes the contract (serve HTTP on `0.0.0.0:$PORT`, publish `README.md` at `/readme/`, run inside one 256MB Fly machine with a single `/data` volume). Given that constraint, the choices were:

- **Node + Express + TypeScript**, compiled with `tsc` to `dist/`, rather than a framework like Next.js — the app is a handful of routes plus one WebSocket surface, and a framework's routing/SSR machinery would add weight without buying anything back inside 256MB.
- **Socket.io** for the real-time layer. A raw `ws` socket would have meant hand-rolling reconnect and room-broadcast logic that Socket.io already provides; the trade-off is a slightly heavier client bundle, which doesn't matter at this scale.
- **`node:sqlite`** (the built-in `DatabaseSync`), not Postgres or a hosted DB. It ships in Node 24.21.0 with no native compile step and no extra service to run inside a 256MB machine, and the single Fly volume at `/data` is exactly the kind of single-writer, single-file storage SQLite is for. The trade-off accepted: this doesn't scale past one machine, which is fine because the Fly deploy is pinned to `--ha=false` anyway.
- **Local accounts with `scrypt` + opaque session tokens** in a `sessions` table, over something like JWTs — no signing secret to manage, and revocation is just deleting a row, which matters more than statelessness for an app this size.
- **Vanilla HTML/CSS/JS** served from Express, no bundler. The Socket.io client is served directly from `/socket.io/socket.io.js`. The brief's own framing — small tools built for a handful of people, not a growth product — argued against reaching for a frontend framework the app doesn't need.
- **`marked`** to render `README.md` at `/readme/`, the smallest dependency that satisfies the spec's requirement that the README's headings appear in order in the served HTML.

## Known simplification

Focus-minute accounting awards every socket present in a room the overlap between their join time and the block's duration when the block ends naturally. This is deliberately not a perfectly fair ledger (a user who disconnects mid-block without the block ending gets nothing for that session) — it was scoped as "accurate enough to make the all-time total meaningful," not as exact time-tracking software.

## Verification

`pnpm typecheck` is clean. `pnpm check` runs `spec/invariants.test.ts` (the course's own `/` and `/readme/` checks) alongside two new specs written against this app's actual contract: `spec/latecomer-sync.test.ts` (a second user joining mid-block gets the server's true remaining time, not a fresh timer) and `spec/focus-enforcement.test.ts` (the server silently drops a `chat:send` sent during a focus block, regardless of what the sender's own client shows). All four pass locally against the running app.

## Decision record: 2026-10-02 — ANU email, configurable focus length, study planning

The user asked for four things on top of the already-complete app: mandate an
ANU email at signup, mandate a username (already true — see below), let
whoever starts a block choose its length, and let people plan ahead to study
at a location, "integrate with ANU library booking" if possible.

- **Email check is format-only, not verification.** `/^[^\s@]+@anu\.edu\.au$/i`
  against the registration payload, checked and rejected server-side before
  the account is created, with a 409 if the (lowercased) address is already
  registered. A real verification-email flow needs a transactional mail
  provider and an API key neither this project nor the course scaffold
  provisions, so the user explicitly chose the format-only option over
  building (or stubbing) a send step. The email is stored but never returned
  from any route — registration, login, and `/api/me` all still return only
  `{ username, ... }` — so the username stays the only thing another user or
  the API itself ever sees, confirming requirement #2 was already true
  without needing a code change.
- **Focus length is a bounded preset list (15/25/45/50 min), not free text.**
  Offered as presets in the planning conversation; the user's own answer
  picked exactly these four and asked for a reset option alongside them,
  rather than a free-form minutes field. Bounded presets, validated
  server-side (the client's choice is just whichever of the four it ticks),
  keep this consistent with the existing "remove choices, don't add them"
  framing already in README.md — a numeric input would reopen the exact kind
  of customization-as-procrastination the original design argued against.
  Reset is restricted to whoever started the block (`started_by`), not anyone
  in the room, specifically to rule out one person ending another's focus
  block as a prank now that blocks have a user-chosen, variable length.
- **Library booking "integration" turned out to be infeasible, and the user
  was told why before scope was set.** `anu.libcal.com` (Springshare/LibCal)
  redirected a read-only room-availability fetch to ANU's SSO login
  (`au.libauth.com`) — confirmed by actually hitting the page, not assumed —
  and there's no public API or embeddable widget documented anywhere for it.
  The only way to show live ANU room availability would be for this app to
  accept a user's real ANU password and drive their SSO session on their
  behalf, which is a credential-phishing shape regardless of intent, so it
  was ruled out outright rather than scoped down. Asked directly whether this
  was a hard technical wall or just out of assignment scope, the answer is
  technical: there's no lower-effort version of "real integration" available
  without that credential problem. What shipped instead, and what the user
  confirmed as the right scope: an in-app planner (schedule a future session
  at a location, visible live to everyone else currently in that room,
  bounded to 14 days ahead to mirror the real library's own booking horizon)
  plus a plain outbound link to ANU's actual booking site — both the UI copy
  and README.md say plainly that this is not a real integration, rather than
  implying a connection that doesn't exist.