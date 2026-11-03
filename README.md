# Shut Up and Read

A real-time, location-based study timer for ANU students, built around one
rigid hourly loop instead of a pile of settings. Pick a real ANU library hub
and one of four cognitive modes, drop a one-line Deliverable Ticket, and board
a Table of up to six people. Everyone's clock is the same server-driven
clock — there is no "start" button for anyone to press.

## The definition of good this app is built to

Most "productivity" software fails by giving you more choices — more
settings, more ways to customize until customizing becomes the
procrastination. This app works by **removing** choices instead: sessions
start only on the hour, nobody can start one early or end one for the group,
and a Table is one of a fixed, hardcoded list of real ANU study spaces, never
a private room you create or name. The server alone holds `phase_end_at`, so
joining mid-block returns the true remaining time, never a freshly-restarted
countdown — and a mid-cycle server restart re-arms every Table's schedule
from that same source of truth rather than losing the cadence.

Good accountability software also knows when you are distracted, not just
when you admit it. The Focus Ring around each boarded student dims the moment
their tab goes hidden — the Page Visibility API reporting straight to the
server — and a tab left hidden too long demotes that person back to a
watching Shadow, withholding credit for the block even if they return and
check out at the end.

## The loop: Table, Ticket, Split-Phase Timer, Break

A Table is keyed by **hub + cognitive mode together** — Silent Focus, Writing
Clinic, Concept Pitch, and Problem-Solving each run as their own independent
Table at every hub, capped at six boarded students apiece. Boarding requires
typing a 60-character Deliverable Ticket; generic filler ("study", "stuff",
"things") is rejected server-side, not just discouraged client-side.

Once the hour turns, a boarded Table's 50-minute focus block begins
automatically for everyone on it at once. Silent Focus stays solo the whole
block. The other three modes open a split-phase timer: a silent **Solo Gate**
(amber) for the first stretch, then an **Open Collab** phase (sage green) —
screens swap in Writing Clinic, pitches go out loud in Concept Pitch, the
stuck get rubber-ducked in Problem-Solving. Problem-Solving is also the only
mode where a ticket can be flagged "stuck," visible to the rest of the table
the moment it's toggled.

At 50 minutes, a break modal opens for ten minutes: check your ticket off as
completed or partial progress, sit with a short mode-specific reflection
prompt, then give kudos and optionally queue your ticket for the next cycle
before the break ends and the Table goes idle again.

## The "Strava for Studying" social layer

Registered accounts persist Verified Focus Hours (VFH) — credited only when
you stay for the entire block *and* check your ticket off at the break, not
for merely showing up. A profile page shows a GitHub-style daily heatmap of
VFH, a breakdown of which cognitive modes and which hubs you actually study
in, and a Buddies list: accepted buddies' completed tickets surface in your
feed. The only positive social signal is a fixed three-emoji Kudos, sent
once per person per cycle, always at the break.

## Strict social limits

No photo uploads — every avatar is a typographic monogram. No direct
messages, no chat rooms, no feeds beyond the Buddy feed above. The interface
avoids ticking seconds and other low-value motion on principle: the timer
shows whole minutes only, flipping once a minute rather than once a second.

## Watching, and joining anonymously

Anyone can watch a Table's live timer and roster without signing in, counted
separately from the boarded roster; every mutating action is rejected
server-side regardless of what the client sends. "Continue anonymously"
grants a random guest name with full participation parity — ticket, timer,
kudos, the Focus Ring — withholding only what needs a persistent identity:
VFH, the heatmap, buddies.

## Concurrency and the six-seat cap

Node handles one socket event at a time with no `await` between reading and
writing state, so when two people reach for a Table's sixth seat at once,
exactly one ticket is accepted and the other is rejected with `table_full` —
never a seventh seat, never a silently dropped request. The same guarantee
resyncs a dropped connection on reconnect: rejoining mid-block returns the
Table's true current state, not a stale or restarted one.

## Deleting an account, completely

Deletion requires re-entering your password and removes that user's tickets,
kudos, buddy connections, and planned sessions — it never touches the shared
Table timer anyone else is on, since no individual owns it.
