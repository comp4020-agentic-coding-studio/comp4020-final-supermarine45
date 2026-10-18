# Agent Directives & Project Rules

## 1. The Definition of "Good"
Good productivity software enforces boundaries through programmatic honesty. By using the Page Visibility API to detect tab switching, the app relies on systemic truth rather than the honor system. It uses digital synchronization to orchestrate physical proximity and social accountability, where walking away from the digital table has immediate, visible consequences for the group. 

## 2. What We MUST Build (The Standards)
*   **Zero-Refresh Guarantee:** Timer states, roster updates, and Tab Visibility color changes (Green to Amber) must reflect on all connected clients within one second via WebSockets.
*   **Server-Side Authority:** What a person may see and change MUST be checked on the server. The backend must explicitly verify active pseudonym status before accepting state-changing payloads.
*   **Server-Side Penalty:** The 60-second distraction penalty must be timed and executed by the backend, never trusted to the client.
*   **Crit Logging:** Every state change must generate a structured, terminal-readable log showing Room, Identity, and Action.

## 3. What We MUST NEVER Build (The Exclusions)
*   **No Client-Side Trust:** Never trust the frontend to enforce the chat lock or the distraction penalty. 
*   **No Forced Login Walls:** Users must be able to join the room and observe as a "Shadow" from the URL alone, using session IDs for identity.
*   **No Asynchronous Social Feeds:** The app is strictly focused on present, real-time focus blocks.

## 4. Required Spec Checks (Test Suite)
1.  **Server Authorization Check:** Test that an unauthenticated socket emitting a `start_timer` event is explicitly rejected by the backend.
2.  **Telemetry Timeout Check:** Test that a `tab_hidden` event triggers the server-side timeout, and failing to emit `tab_visible` within the window results in user demotion.
3.  **Readme Verification:** Test that the `/readme` route successfully parses and serves the `README.md` file to the DOM.