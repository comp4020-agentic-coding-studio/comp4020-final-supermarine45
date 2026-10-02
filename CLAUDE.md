# Agent Directives & Project Rules

This document defines the strict rules derived from this project's definition of "good"[cite: 1]. It outlines the standards the agent's work must meet, what the app must never do, and what tests must pass[cite: 1].

## 1. The Definition of "Good"
Good productivity software builds long-term habits through persistent academic identity and enforces boundaries by eliminating choices. It uses digital synchronization to orchestrate physical proximity and social accountability while strictly minimizing digital distraction[cite: 1]. The app must feel alive because other real, authenticated people are studying at the same ANU location simultaneously, using that shared digital presence to drive real-world focus[cite: 1].

## 2. What We MUST Build (The Standards)
*   **Zero-Refresh Guarantee:** Any change to the timer state, user presence (join/leave), or room headcount must reflect on all connected clients within one second via WebSockets[cite: 1].
*   **Location Strictness:** The application is hardcoded to ANU campus locations. Users cannot create custom digital rooms.
*   **Flawless Latecomer Sync:** If a user joins an active room, they must instantly sync to the running clock. The single source of truth for time is the server.
*   **Persistent Statistics:** User accounts must reliably accumulate and display all-time focus minutes[cite: 1].

## 3. What We MUST NEVER Build (The Exclusions)
*   **No Private Messaging:** Users cannot privately message each other. 
*   **No Unbounded Chat:** The input field for the room's break chat MUST be programmatically disabled and visually greyed out the exact millisecond the synchronized focus timer starts.
*   **No Complex Social Networking:** While users have persistent accounts, do not build "friend requests," "follower counts," or asynchronous social feeds. The focus remains on real-time presence at physical ANU locations.

## 4. Required Spec Checks (Test Suite)
Every critical feature must have a test in the `spec/` folder[cite: 1]. We require the following checks:
1.  **Latecomer Sync Check:** Test that a simulated user joining an active room receives the accurate countdown state from the server[cite: 1].
2.  **Focus Enforcement Check:** Verify that the chat input is strictly disabled while the focus timer state is > 0[cite: 1].
3.  **Readme Verification:** Test that the `/readme` route successfully parses and serves the `README.md` file to the DOM[cite: 1].