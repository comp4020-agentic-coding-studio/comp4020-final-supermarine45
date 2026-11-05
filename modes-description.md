| Mode | Solo portion | Then | Breakout extra |
|---|---|---|---|
| **Silent Focus** | Solo, whole 50 min | — | none |
| **Writing Clinic** | Solo drafting, 0–40 min | Swap screens, give feedback, 40–50 min | none |
| **Concept Pitch** | Solo prep, 0–40 min | Explain your concept out loud, 40–50 min | none |
| **Problem-Solving** | Solo attempt, 0–40 min | Rubber-duck/swarm the stuck ones, 40–50 min | Shared **Whiteboard** auto-opens if the leader hasn't launched it by minute 41 |

- `splitMsFor(mode)` returns `null` for Silent (no split — stays "solo" the whole time) and 40 minutes (scaled proportionally if the cycle is shortened) for the other three.
- The split is computed live from elapsed time (`computeSubphase`), not a separate timer — every `room:update` broadcast recalculates `"solo" | "collab" | null`.
- In the UI (`PhaseBanner.tsx`), this becomes: **Kickoff** (first 2 of 50 min, client-only label) → **Solo Gate** (amber, OLED black) → **Open Collab** (sage green, OLED black) for writing/pitch/problem, or just **Focus** throughout for Silent.

## Break (10 minutes, identical flow for all 4 modes)

A 4-step modal walks everyone through:
1. **Stamp** your ticket — "Completed it" or "Partial progress"
2. **Reflect** — a 90-second mode-specific SSRL prompt (the only content that differs by mode here)
3. **Kudos** — give emoji kudos to others at the table, optionally queue a ticket to re-board for the next cycle
4. **Rollover Vote** — the pod leader (earliest-boarded ticket) can open a vote to roll the whole table into another cycle; if they don't, it **auto-opens 2 minutes before break ends**. Needs ≥50% turnout and yes > no to pass; passing increments each yes-voter's streak, anything else resets it.

## Fallback timers (self-healing, no manual trigger needed)
- **Whiteboard** (Problem-Solving only): auto-opens at minute 41 if the leader hasn't launched it.
- **Rollover Vote**: auto-opens at the 8-minute mark of break (2 min before it ends) if the leader hasn't opened it.
- **Tab-hidden penalty**: hide the tab for 60s during focus → demoted to Shadow (read-only, can't submit/vote/stamp) for that cycle.

So the "every 1 minute" symptom you originally saw wasn't a mode difference — all 4 modes run the same 50/10 cycle; that was almost certainly your browser pointed at one of the leftover test-speed server instances (18-second total cycle) rather than the real one on :8080.