1. The Mechanic: The "Picture-in-Picture" (PiP) Dashboard
Modern web browsers support a feature called the Picture-in-Picture API (traditionally used to keep a YouTube video floating on your screen while you browse other tabs). We can hijack this API to create a floating, always-on-top widget that doesn't require a Chrome extension.

How it works: When the session starts, the student clicks a button to "Pop Out" the timer. The app renders a clean, minimalist HTML <canvas> containing just the 50-minute countdown.

The Benefit: The student can full-screen VS Code or Google Docs, and the tiny "Shut up and Read" timer floats unobtrusively in the corner of their screen, keeping them anchored to the group's pacing.

2. Notifications: The Background Service Worker
If a student has the app minimized, they still need to know when the Solo Gate ends, when they receive a Kudo, or when the Whiteboard session starts. This is handled by a standard Web Background Service Worker.

Audio Chimes: The web app plays a distinct, gentle audio chime when the phase shifts (e.g., from silent to Collab Phase).

OS-Level Web Notifications: When a significant event occurs, the browser pushes a native notification to the student's Mac or Windows notification center.

Example 1: 🟢 Collab Phase Unlocked: "Sarah (Pod Leader) has opened the Whiteboard. Click here to join."
Example 2: ⚡ Encouragement: "David sent you a Kudo for your focus block!"

3. Redesigning Accountability: The "Check-In" Ping
As we can't always track tab visibility (because they should be in other tabs), how do we prevent social loafing and ensure they haven't just walked away from their laptop?

We replace the hard 'inactivity' tracking we currently have implemented with Micro-Check-Ins.

The Mechanic: Twice during the 50-minute block (e.g., at minute 20 and minute 35), the web app checks that the user is still active on their computer (the computer is not idle or sleep).



=======================================================================================================
"Library Stats"
The Problem: The Strava-style stats are great for the individual, but the locations (e.g., Hancock Level 2) feel empty if you are the only one there at 8:00 AM.The Feature:
Aggregate the VFH (Verified Focus Hours) data at the Room level.
On the /room/:slug page, display a persistent, running "Stats" stat block.
Example UI: "🔥 450 Verified Focus Hours logged here this week. Last active table rolled over 3 times."
Psychological Benefit: It gamifies the ANU campus itself. Different colleges/libraries subtly compete for the most deep work logged, making the app feel "alive" even when a student logs on during off-peak hours.

"Peer Review" feature for Writing Clinic mode
Your summary beautifully details the Problem-Solving whiteboard, but the Writing Clinic needs its own specific live interaction during the Collab Phase.The Feature:
At minute 40, the Collab Phase opens a "Peer-review" portal.
Students paste up to 200 words of their draft. The server randomly shuffles the texts among the table members (or pairs them up).
Users cannot type feedback. They are only given three highlighter cursors: 🟢 (Strong), 🟡 (Confusing), 🔴 (Needs Citation).
Live Replicated Effect: As you drag your yellow cursor over a confusing sentence on your screen, the original author sees their text highlight yellow in real-time.

"Pivot Goal"
The Problem: The 60-character Deliverable Ticket is locked at T-00:00. But deep work is unpredictable. What if a student finishes their micro-goal 20 minutes into the 50-minute focus block? Or realizes they are reading the wrong chapter?The Feature:
Allow users to double-click their ticket mid-session to Pivot.
They type a new 60-character goal.

Live Replicated Effect: On everyone else's screen, the old ticket gets a neat strikethrough, the new ticket types out, and a silent, transparent ripple animation pulses across the table.

Psychological Benefit: This turns a static UI into a live feed of momentum. Seeing a peer cross off a goal and set a new one mid-session provides a massive dopaminergic push (the Co-Action Effect) to the rest of the table. In the Break Modal, their stamp options become Completed, Partial, or Pivoted.

=======================================================================================================

Give me summaries of all the features made thus far.

=======================================================================================================
display initially the building, then in each bulding, display the study spaces. This list should be comprehensive

- Improve the visuals of the countdown timer to match apple's countdown timer, with old school flipping windows

- resize the window to fill the screen better.

+ create logout after 5 minutes inactivity

- Joining should be automatic. As in the session starts when the user is in the room and click that It would like to join, no one needs to start

- In the stats, I want to see previous tickets/goals, and see which one I have completed, or which one I have yet to complete. When I log out or log in a session, it should show past goals which were not yet completed. This will highlight the persistence of information in the application.

- What is the time line for each of the modes? I get solo time every 1 minute, instead of the actual pomodoro style timer.

Add ways to give encouragements between users.

Depending on user permission, will it possible to lock the user’s window (ex? To have the user very focused.
