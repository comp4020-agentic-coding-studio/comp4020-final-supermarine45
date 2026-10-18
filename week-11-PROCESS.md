# Process overview

## What I built

Week 11's brief ("Fly by instruments") asked for accountability that doesn't
rely on an honor system: a way to join a room with zero friction, a way to
tell the group when someone has actually looked away, and a guarantee that
both of those are enforced by the server, not trusted from the client. I
built this as three additive pieces on top of the existing account system —
nothing about registration, login, guests, or scheduling changed.

1. **Session-backed pseudonym identity.** A visitor can already watch a room
   as a read-only "Shadow" from the URL alone, with no login wall. Week 11
   adds a second way out of Shadow besides creating a real account: typing a
   name. `set_pseudonym` mints a guest-style identity — same negative-id
   convention `createGuestIdentity` already used for anonymous guests, just
   with a caller-chosen name instead of a random one — and the socket is
   migrated out of `shadowCounts` straight into the room's `presence` map, no
   page reload required for that conversion itself. The only reload is to
   adopt the resulting session cookie (a WebSocket handler has no `Response`
   to set a cookie on), via one small new endpoint, `POST
   /auth/adopt-session`, that does nothing but write the cookie for a token
   the client just received from its own socket.
2. **Tab-focus telemetry.** Every connected client — real account, guest, or
   pseudonym alike — reports the Page Visibility API's state unconditionally.
   The server, not the client, decides what that means: a hidden tab starts
   a 60-second server-side timer (`TAB_HIDDEN_PENALTY_MS`) and flips that
   user's roster dot amber for everyone else watching; returning before the
   deadline clears it back to green with no penalty. Letting the full window
   elapse demotes the user back to Shadow, caps the focus minutes they're
   credited for at the moment their tab went dark (not an all-or-nothing
   wipe — `awardFocusMinutes` now computes an effective cutoff), and
   broadcasts a notice naming them to the room.
3. **Explicit server-side rejection.** Every handler that mutates shared room
   state already checked for an authorized identity before this week; the
   gap was that a failed check just silently dropped the event. Each of
   those ten handlers now emits `room:unauthorized` with a structured
   `{ error, action }` payload on rejection, so an unauthorized attempt is
   observable, not just invisible.
4. **Structured narration logging.** A new `src/logger.ts` centralizes a
   `[TIMESTAMP] [Room: NAME] [IDENTITY] - ACTION` format and is called from
   every connect, disconnect, pseudonym conversion, unauthorized rejection,
   tab-hidden/tab-visible transition, and penalty demotion.

## Process

The hardest design decision was where a typed pseudonym's session should
live. The brief calls for "session IDs" and no database passwords, which
this project already had in two forms: a DB-backed `sessions` table for real
accounts, and a pure in-memory `guestSessions` map for anonymous guests.
Rather than add a third mechanism (e.g. `express-session`) for pseudonyms, I
reused the guest map directly — a pseudonym is simply a guest identity with
a name the user chose instead of one generated for them. That meant the
existing 24-hour idle sweep for guests covers pseudonyms for free, and every
downstream check that already branches on `isGuest(id)` (stats page gating,
account deletion eligibility) needed no changes at all.

The second decision was how literally to follow the brief's event names.
CLAUDE.md's spec checks reference `start_timer` and `submit_vote`, but this
codebase's actual, already-tested event surface uses `room:start-focus` and
`room:vote`. Renaming the existing events would have broken a passing test
suite for no behavioural benefit, so I kept the existing names and added the
new enforcement/logging to them, documenting the mapping below rather than
treating it as an oversight.

| Brief's term | This codebase's event |
| --- | --- |
| `start_timer` | `room:start-focus` |
| `submit_vote` | `room:vote` |
| `send_chat` | `chat:send` |
| (new, same name) | `set_pseudonym`, `tab_hidden`, `tab_visible` |

Third, "strip their minutes" needed a concrete mechanics decision. Deleting
a demoted user's presence entry outright would have made them simply
disappear mid-block with no credit for the time they were genuinely
present — arguably harsher than the brief intended, and it would have broken
`awardFocusMinutes`, which needs to find every present user at phase-end to
compute their credit. Instead, a demoted entry is kept (just filtered out of
the visible roster and occupancy count immediately) and
`awardFocusMinutes`'s cutoff is capped at the moment their tab went hidden —
so a user who focused for 20 minutes of a 25-minute block and then
disappeared is credited 20 minutes, not 0 and not 25.

Finally, the 60-second penalty needed a test, and this codebase has a
strict no-fake-timers convention — every existing timing test waits out a
real `setTimeout` against the actually-running server. I followed that
convention for the new test rather than introducing a test-only timing
backdoor, accepting the roughly one-minute cost to the suite's total
runtime in exchange for proving the timeout is really server-timed and not
just cosmetically modeled.
