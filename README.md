# Shut Up and Read: ANU Focus

A real-time, location-based study timer for ANU students. You sign in with a
real account, pick one of five fixed ANU libraries, and join whoever else is
there right now. Someone starts a 25-minute focus block; everyone in the room
watches the same clock tick down, synced to the second, with no refresh. When
the block ends, a 5-minute break opens the room's chat; when the next block
starts, the chat locks again, mid-sentence if it has to.

## The definition of good this app is built to

Most "productivity" software fails by giving you more choices: more settings,
more ways to customize a focus session until customizing it becomes the
procrastination. This app's position is that good productivity software works
by **removing** choices, not adding them. You cannot create a room, name a
room, or invite someone to a private one. There are exactly five rooms,
because there are exactly five libraries, and the whole mechanism depends on
the room standing for a real, walkable place at ANU — Marie Reay, Chifley,
Hancock, Menzies, Law. The room is alive because the people in it are
provably, physically real: they are logged in with persistent accounts that
accrue all-time focus minutes, and the timer they're watching is the same
timer everyone else in that building is watching, driven by one clock on the
server rather than five drifting clocks on five laptops.

That last part is a hard technical requirement, not a nicety: the server
holds the only authoritative `phase_end_at`, an absolute timestamp rather than
a countdown. A client that joins four seconds into a block, or four minutes
into a dropped-and-restored connection, asks the server what time it is and
gets back the real remaining time — not a freshly-restarted 25:00, which
would be a lie about how far along the room actually is. That lie is exactly
what a late-joining user needs to *not* see for the "shared presence" premise
to mean anything.

## What's deliberately missing

The brief that shaped this project was about building small, for a handful of
people, instead of defaulting to growth-product features no one asked for.
So this app has no private messages, no friend requests, no follower counts,
and no feed of what anyone else has been doing. The only channel between two
users is the shared room chat, and that chat only exists during the break —
it is not a general-purpose messaging feature that happens to be scoped to a
room, it is specifically the five minutes of social contact the Pomodoro
technique already prescribes. Locking it the instant focus starts isn't a UI
nicety either: the server rejects a `chat:send` event sent during a focus
block regardless of what the sending client's own interface shows, because
the rule that matters is the one a bypassed or buggy client can't get around.

## What "alive" means here

A stranger who opens this app, picks a library, and starts a focus block
should be able to leave, come back, and find their own focus minutes still
counted on their account — that persistence is the whole bet. A second
stranger joining the same room mid-block should see the exact time left, not
a fresh timer, because that's the difference between a room that is actually
synchronized and one that only looks synchronized until you check the clock.

## A real ANU identity, but still just a username to everyone else

Signing up requires an `@anu.edu.au` address, checked by format only — there's
no verification email, because sending one needs a mail-sending service and an
API key this project hasn't provisioned, so the gate is honest about being a
domain check rather than proof of a live mailbox. The point of requiring it at
all isn't to show it to anyone: the username is still the only identity the
app ever displays, broadcasts, or returns from an API call, in the roster, in
chat, in `/api/me`. Tying signup to a real ANU address just means the
"real, physically real people" premise the rest of this README leans on is
backed by something a bit stronger than an email field nobody checks.

## Choosing how long to focus, and the right to end it early

A block's length is one of four fixed presets — 15, 25, 45, or 50 minutes —
picked by whoever starts it, in keeping with this app's stance that good
productivity software removes choices rather than adding them: a free-form
number input would turn "how long should I focus" into its own small
procrastination. The server is the only thing that enforces the bound; a
client that sent anything else would be ignored, the same posture as the
chat-lock rule above. Whoever starts a block can also end it early with a
Reset button — but only that person, not anyone else in the room, so a block
can't be griefed by someone else in the room cutting it short. A reset still
banks partial focus minutes for the time that did elapse.

## Planning ahead, honestly

You can mark intent to study at a location ahead of time — up to two weeks
out, mirroring the real ANU library's own booking horizon — and anyone else
who opens that room sees it appear immediately, the same live, no-refresh
channel the roster and timer already use. This is **not** an integration with
ANU's library room-booking system: that system (`anu.libcal.com`) requires
ANU SSO login even to view read-only room availability, and the only way to
build a real integration would be for this app to accept and replay a user's
real ANU password, which is a hard no regardless of how useful the feature
would be. So the room page is honest about what it actually does: an in-app
planner that's visible to everyone in that room, plus a plain link out to
ANU's own booking site for anyone who wants to reserve an actual room.

A booking you make is never just a line in the room you made it from, either:
it shows up immediately (read straight from the server on page load, not
waiting on the first socket round-trip), it's counted as an "N planned" badge
on that location from the home page, and it's listed on your own home page
under "your upcoming sessions" regardless of which room you booked it in —
so there's exactly one honest answer to "what have I actually booked,"
not five rooms to check.

## A shared goal list, and the accountability of a review window

At the start of a block, anyone in the room can add a few lines to a shared
goal list — not a personal to-do list, a **room** one, consistent with
everything else in this app being visible to whoever's physically there
rather than private to one account. If the list still has unchecked items
when the clock runs out, the room doesn't jump straight to break: it enters a
short review window first, where chat opens and the unfinished items sit on
screen, and anyone currently in the room can extend the block by one of the
same four fixed presets to keep working the list. Nobody is forced to decide
anything — if the window lapses with nobody extending, the list is cleared
and the room moves on to break exactly as if there'd been no goals at all.

Extending is deliberately open to **anyone** in the room, not just whoever
started the block — unlike Reset, which stays restricted to that one person.
The asymmetry is the point: cutting a block short can be used to grief
everyone else still working, so only the person who started it can do that;
adding more time never can, so there's no reason to gate it the same way.
And there's no separate "quit" button for review, because there was never a
missing one — leaving a room by navigating away has always been possible at
any time, including mid-review, and the review window is a chance to extend,
not a lock on the door.

## Anonymous entry, honestly implemented

"Continue anonymously" gets you a random name — an adjective and an animal,
like "Sleepy Koala 42" — never one you pick, so a guest can never pick a name
that collides with or impersonates a real signed-in user. A guest can join a
room, start and extend blocks, chat, and add or check off shared goals with
full parity to a real account; the only things withheld are the ones that are
meaningless for an identity guaranteed not to last — no focus-minutes figure,
no place in anyone's statistics, and no access to the forward-looking study
planner, since planning ahead is a commitment to a future this identity won't
be around for.

The "won't persist beyond this session" promise is implemented as literally
as possible: a guest identity has no row in the database at all, not a users
row that gets deleted later. It lives only in server memory for as long as
the process and that browser tab are both still around, under the same
session-cookie mechanism a real login uses, so none of the room/timer/chat
code has to know or care which kind of identity it's looking at.

## Deleting an account, completely

Account deletion is behind re-entering your password, with the consequences
spelled out in plain text next to the button rather than a browser `confirm`
popup that's too easy to click through without reading. Deleting an account
deletes your chat history and your planned sessions, not just your login —
this app doesn't have a lesser "deactivate" option, because partial deletion
would make the "delete my account" button a lie. If the account mid-deletion
is in the middle of running a focus block for a room with other people still
in it, that block is ended first: everyone present banks the partial focus
minutes they'd actually earned, and the room returns to idle cleanly rather
than being left pointing at a `started_by` that no longer exists.
