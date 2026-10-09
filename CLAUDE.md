# Agent Directives & Project Rules

This document defines the strict rules derived from this project's definition of "good"[cite: 1]. It outlines the standards the agent's work must meet, what the app must never do, and what tests must pass[cite: 1].

## 1. The Definition of "Good"
Good productivity software builds long-term habits through persistent academic identity and enforces boundaries by eliminating choices. It uses digital synchronization to orchestrate physical proximity and social accountability while strictly minimizing digital distraction[cite: 1]. The app must feel alive because other real, authenticated people are studying at the same ANU location simultaneously, using that shared digital presence to drive real-world focus[cite: 1]. A block can also start by a room-wide vote instead of one person picking a preset alone — the vote resolves into a block that begins exactly on the next `:00`/`:30` wall-clock mark, so a group can coordinate a shared start time without anyone having to unilaterally decide it for everyone else. This is an additional path alongside the existing instant-start-by-preset flow, not a replacement of it.

## 2. What We MUST Build (The Standards)
*   **Zero-Refresh Guarantee:** Any change to the timer state, user presence (join/leave), or room headcount must reflect on all connected clients within one second via WebSockets[cite: 1].
*   **Location Strictness:** The application is hardcoded to ANU campus locations. Users cannot create custom digital rooms.
*   **Flawless Latecomer Sync:** If a user joins an active room, they must instantly sync to the running clock. The single source of truth for time is the server.
*   **Persistent Statistics:** User accounts must reliably accumulate and display all-time focus minutes[cite: 1].
*   **Shadow Viewing:** An unauthenticated visitor can observe a room's live timer, roster, and chat in real time, but every mutating action is rejected server-side regardless of what the client's own UI shows.
*   **Schelling Alignment:** A Lobby's resolved focus block always begins exactly on a `:00`/`:30` wall-clock boundary, never at an arbitrary moment relative to when the vote happened to end.
*   **Lobby Override (FIFO Lock):** If two users attempt to start the same room's focus timer at effectively the same millisecond, the server must process only the very first payload it receives, lock the room state, and broadcast the winning timer to every client. The second payload is rejected outright — never merged, queued, or allowed to produce a different result on a different client.
*   **Focus Spark:** During an active focus block (when chat is locked), a user can send one transient "spark" signal to everyone else in the room (and themselves) via WebSocket — no page reload. It renders as a brief fading visual pulse paired with one short encouraging line, not a user-authored message — the line is picked server-side from a fixed pool, identical for every viewer of that spark, so there is still nothing a sender can type. Sending is rate-limited server-side to one per user every 10 seconds regardless of client-side button state, and can be repeated any number of times across a block.

## 3. What We MUST NEVER Build (The Exclusions)
*   **No Private Messaging:** Users cannot privately message each other. 
*   **No Unbounded Chat:** The input field for the room's break chat MUST be programmatically disabled and visually greyed out the exact millisecond the synchronized focus timer starts.
*   **No Complex Social Networking:** While users have persistent accounts, do not build "friend requests," "follower counts," or asynchronous social feeds. The focus remains on real-time presence at physical ANU locations.

## 4. Required Spec Checks (Test Suite)
Every critical feature must have a test in the `spec/` folder[cite: 1]. We require the following checks:
1.  **Latecomer Sync Check:** Test that a simulated user joining an active room receives the accurate countdown state from the server[cite: 1].
2.  **Focus Enforcement Check:** Verify that the chat input is strictly disabled while the focus timer state is > 0[cite: 1].
3.  **Readme Verification:** Test that the `/readme` route successfully parses and serves the `README.md` file to the DOM[cite: 1].
4.  **Voting Resolution Check:** Verify that when a Lobby's vote resolves, the preset with the most votes wins, and a tie resolves to the shorter preset.
5.  **Lobby Override Race Check:** Simulate two concurrent `room:start-focus` WebSocket emissions from two different clients; verify the server honors only the first and every connected client (including a third, non-racing observer) converges on the identical resulting room state.