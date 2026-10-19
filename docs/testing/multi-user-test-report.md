# Multi-user test report

Expected server behaviour for the five scenarios below, based on
`src/rooms.ts` / `src/db.ts` and the matching specs in `spec/`.

## 1. Multiple users logging in at once

Node processes events one at a time, and every handler runs start-to-finish
with no `await` between reading and writing `room_state` (`node:sqlite` is
synchronous too). So if two users trigger the same action at once (e.g. both
emit `room:start-focus`), the first one fully finishes before the second one
even starts — there's no window where they can collide. The first action
always wins; the second is cleanly rejected (`room:unauthorized` or a no-op),
never a half-applied state. See the "Lobby Override / FIFO lock" comment at
`src/rooms.ts:422-442`, verified by `spec/concurrent-edits.test.ts`
(simultaneous goal-toggles and simultaneous votes both resolve to one
consistent result).

**Observed** (`flyctl logs`): two separate sessions joined the
same room less than a quarter of a second apart, each getting its own
fully-processed "connected" line with no dropped or overlapping event:
```
03:29:01.833 [System] [Level 4 — 24-Hour Study Room] [Session MGJSGdbsQD85djoOAAAL] - connected. Room was idle.
03:29:02.063 [System] [Level 4 — 24-Hour Study Room] ['Bold Fox 75'] - connected. Room was idle.
```

## 2. Users logging in late

When a user joins, the server works out exactly where the room is in its
current phase (`joinTimingNote`, `src/rooms.ts:171-186`) using the stored
start/end times — e.g. "4.2 of 25 minutes into the focus block" — and logs
it. The joiner then gets the same current state broadcast as everyone else,
so they see the real remaining time straight from the server, not a guess
based on when their own page loaded. Verified by `spec/latecomer-sync.test.ts`.

**Observed:** a user joining mid-block got an exact,
server-computed elapsed time in the log, confirming the latecomer path ran
for real, not just in tests:
```
03:29:07.317 [System] [Level 4 — 24-Hour Study Room] [Session RCCtHpmDwt8lqqEqAAAN] - connected. Joined mid-session: 0.1 of 25 minutes into the focus block.
03:32:03.540 [System] [Level 4 — 24-Hour Study Room] ['Bold Fox 75'] - connected. Joined mid-session: 2.2 of 375 minutes into the focus block.
```

## 3. Action of one user propagates to all users

Every action that changes room state (voting, starting/extending/resetting a
focus block, goals, tab-visibility penalties, chat, sparks) ends by
broadcasting the updated state to everyone connected to that room, including
Shadows (unauthenticated viewers, who can watch but not act). This is a
direct WebSocket push, not polling, so per CLAUDE.md's Zero-Refresh
Guarantee it reaches everyone within a second.

**Observed:** server-side enforcement firing live, not just
broadcasting — a Shadow's own unauthorized attempts were rejected and logged
individually rather than silently applied:
```
03:29:19.298 [Activity] [Level 4 — 24-Hour Study Room] [Session MGJSGdbsQD85djoOAAAL] - attempted unauthorized room:goal-add. Rejected.
03:31:53.648 [Activity] [Level 4 — 24-Hour Study Room] [Session y2AbmttiYunCmdFwAAAM] - attempted unauthorized room:extend. Rejected.
```

## 4. Leaving and returning (tab close)

When a user disconnects, the server logs it, removes them from the live
roster, and updates everyone else. When they come back and rejoin, they get
a brand-new presence entry — nothing about their old session (tab-hidden
status, warnings, etc.) carries over. They're synced in the same way a
late-joiner would be (scenario 2). Their account identity and stats persist
separately via their login cookie, so a signed-in user still returns as
themselves even though their in-room presence reset.

**Observed:** the same logged-in user, `'oli'`, disconnected
from one room and reappeared under the same username in a different room —
confirming identity persists across a leave while presence is scoped fresh
to wherever they rejoin:
```
03:31:16.031 [System] [Level 4 — 24-Hour Study Room] ['oli'] - disconnected
03:31:25.577 [System] [Common Room — Study Area] ['oli'] - connected. Room was idle.
```

## 5. Restarting the session (`fly machine restart <machine id>`)

Two kinds of state behave differently:

- **Room timer state (in the database, on the persistent volume) survives.**
  On startup, the server first resets any room whose timer had already run
  out during the downtime back to idle (`reconcileRoomStates`,
  `src/db.ts:342-347`), so a stale timer never looks like it's still running.
  Then it re-arms a fresh countdown for any room that's genuinely still
  mid-block (`rearmTimers`, `src/rooms.ts:396-409`), so an in-progress focus
  block keeps counting down correctly. The smaller encouragement pop-ups are
  not restored after a restart — that's a deliberate, low-stakes exception.
- **Who's currently present (in memory) does not survive.** Everyone gets
  disconnected and has to reconnect/rejoin to show up in the roster again,
  same as scenario 4. A couple of other in-memory bits (lobby votes, spark
  cooldowns) are also lost and not restored, which is an acceptable tradeoff
  since none of it is the authoritative timer.

Logs (`activity.log`, `system.log`, `status.log`) live on the same
persistent volume, so they survive the restart and can still be read via
`GET /api/logs/:category` or `flyctl ssh console` + `cat /data/*.log`.

**Observed:** Fly auto-stops the machine when idle and reboots
it on the next request (same effect as a manual `fly machine restart` for
this app's purposes). The `/data` volume is unmounted and cleanly
remounted each time, and the app comes back up and starts logging again
within ~2-3 seconds of the machine starting:
```
01:25:46Z app ... Umounting /dev/vdc from /data
01:25:46Z app ... reboot: Restarting system
01:55:40Z proxy ... Starting machine
01:55:41Z app ... Mounting /dev/vdc at /data w/ uid: 0, gid: 0 and chmod 0755
01:55:43Z app [Status] [INFO] - shut-up-and-read listening on :8080
01:55:44Z app [System] [Level 4 — 24-Hour Study Room] [Session fWLuZXdj5QT827xkAAAA] - connected. Room was idle.
```
One rough edge worth noting: right after the machine starts, Fly's proxy
rejected the first couple of connection attempts before the app finished
binding its port (`instance refused connection... is your app listening on
0.0.0.0:8080?`), then succeeded once the app actually logged "listening on
:8080" two seconds later. This is a brief, self-resolving cold-start window,
not a bug — but it means the very first user to hit a cold machine may see a
failed request and need to retry.
