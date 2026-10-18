# Shut Up and Read: ANU Focus

A real-time, location-based study timer for ANU students. Sign in, pick a
real ANU building and study space, and join whoever else is there now.
Someone starts a focus block; everyone watches the same clock tick down,
synced to the second, with no refresh. A 5-minute break opens the room's chat
when it ends; the next block locks it again mid-sentence if it has to.

## The definition of good this app is built to

Most "productivity" software fails by giving you more choices — more
settings, more ways to customize until customizing becomes the
procrastination. This app works by **removing** choices instead: you cannot
create, name, or invite someone to a private room — every room is one of a
fixed, hardcoded list of real ANU study spaces, alive because everyone in it
is a provably real, logged-in account watching one clock the server drives,
not a separate drifting clock per laptop. The server alone holds
`phase_end_at`, so joining mid-block returns the true remaining time, never a
freshly-restarted countdown.

Good accountability software also knows when you are distracted, not just
when you admit it. The room removes the honor system by using programmatic
honesty — the Page Visibility API reporting a hidden tab straight to the
server — to visually signal to the rest of the group who is actually doing
the work, rather than trusting anyone's word for it.

## What's deliberately missing

No private messages, friend requests, follower counts, or feeds — the brief
was about building small, not chasing growth. The only channel between users
is the room chat, open only during the break; the server rejects `chat:send`
during focus regardless of the client UI.

## Identity, choice, and accountability

Signing up requires an `@anu.edu.au` address, but the username is still the
only identity shown. A block's length is one of four fixed presets; whoever
starts it can end it early, banking partial minutes, but nobody else can —
extending stays open to everyone, since it can't grief the room. You can also
plan a session ahead; this is **not** an integration with ANU's real booking
system, so the page is honest about being its own planner plus a link to
ANU's actual site. A shared goal list opens a short review window if
unfinished when a block ends, where anyone can extend to finish it —
otherwise it clears and the room moves to break.

## Watching, and joining anonymously

Anyone can watch a room's live timer, roster, and chat without signing in, as
a "watching" count distinct from the roster; every mutating action is
rejected server-side regardless of the client. "Continue anonymously" grants
a random name with full participation parity, withholding only what needs a
persistent identity: stats, planning, a database row.

## Multi-user decisions this app had to make

Two decisions matter most once people share one room. First: anyone can
propose a group vote instead of picking a preset alone. The block waits for
the next `:00`/`:30`-second wall-clock mark, and until then anyone present
casts a live, re-votable tally; most votes wins, a tie goes shorter, letting
a group converge on a shared start time without negotiating it directly.
Second: nothing stops two people reaching for "start," or toggling the same
goal, at once. Node handles one event at a time with no `await` between
reading and writing state, so exactly one request takes effect and every
client converges on the identical result — the same guarantee that resyncs a
dropped connection on reconnect. During focus, chat is locked but a single
wordless "spark" — a rate-limited, system-picked encouraging line — is still
live.

## Deleting an account, completely

Deletion requires re-entering your password and removes chat history and
planned sessions, not just the login. A running block ends first, banking
everyone's partial minutes before the room goes idle.
