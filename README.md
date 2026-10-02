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
