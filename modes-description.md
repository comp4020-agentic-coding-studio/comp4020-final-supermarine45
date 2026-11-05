| Mode | Solo portion | Then | Breakout extra |
|---|---|---|---|
| **Silent Focus** | Solo, whole 50 min | — | none |
| **Writing Clinic** | Solo drafting, 0–40 min | Swap screens, give feedback, 40–50 min | none |
| **Concept Pitch** | Solo prep, 0–40 min | Explain your concept out loud, 40–50 min | none |
| **Problem-Solving** | Solo attempt, 0–40 min | Rubber-duck/swarm the stuck ones, 40–50 min | Shared **Whiteboard** — anyone at the table can launch it, and it auto-opens if nobody has by minute 41 |

- `splitMsFor(mode)` returns `null` for Silent (no split — stays "solo" the whole time) and 40 minutes (scaled proportionally if the cycle is shortened) for the other three.
- The split is computed live from elapsed time (`computeSubphase`), not a separate timer — every `room:update` broadcast recalculates `"solo" | "collab" | null`.
- In the UI (`PhaseBanner.tsx`), this becomes: **Kickoff** (first 2 of 50 min, client-only label) → **Solo Gate** (amber, OLED black) → **Open Collab** (sage green, OLED black) for writing/pitch/problem, or just **Focus** throughout for Silent.

## Break (10 minutes, identical flow for all 4 modes)

A 3-step modal walks everyone through:
1. **Stamp** your ticket — "Completed it" or "Partial progress"
2. **Reflect** — a 90-second mode-specific SSRL prompt (the only content that differs by mode here)
3. **Kudos** — give emoji kudos to others at the table, optionally queue a ticket to re-board for the next cycle

Leaving the room is always available from the modal, on every step — there is no forced path through to re-boarding.

Rolling over to the next cycle is a purely individual choice, not a group vote: if you re-board and your ticket from the cycle before that was stamped "Completed it", your streak (`current_streak`) increments by one; if it wasn't (partial, or you didn't reboard that one either), re-boarding resets your streak to 0. There is no quorum, no leader action, and no effect on anyone else's streak — each person's own reboard-and-stamp history is all that counts.

## Fallback timers (self-healing, no manual trigger needed)
- **Whiteboard** (Problem-Solving only): auto-opens at minute 41 if nobody has launched it — launching it is open to anyone at the table, not leader-gated.
- **Tab-hidden penalty**: hide the tab for 60s during focus → demoted to Shadow (read-only, can't submit/stamp) for that cycle.

So the "every 1 minute" symptom you originally saw wasn't a mode difference — all 4 modes run the same 50/10 cycle; that was almost certainly your browser pointed at one of the leftover test-speed server instances (18-second total cycle) rather than the real one on :8080.