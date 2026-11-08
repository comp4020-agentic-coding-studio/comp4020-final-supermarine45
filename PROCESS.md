## Process: Final modifications made
In the final weeks, I realized that although the product met its functional requirements, it lacked overall cohesion and flow. I therefore revisited the app's purpose and target users, redesigning the workflow around four distinct "ways of working".
> "I would like to reshape the prototype.
> The Problem: ANU students want the cognitive benefits of group study (increased persistence, shared cognitive load, and motivation), but struggle with the logistics of scheduling and the friction of actual group work (distraction, social loafing, and shared misconceptions).
> The Solution: A lightweight, desktop-only web application that facilitates structured, on-demand study sessions at ANU library hubs. Inspired by the Shut-up-and-Write (SUAW) 50/10 Pomodoro format, the app instantly matches students sitting in the same library for an hour of highly structured, side-by-side productivity."

## Final feature selections
1. **Hourly session**, where sessions start. This differs from previous design of the app, in which users must start a session:
> "The "Hourly Train" Timetable
> How it works: Instead of allowing users to create custom session times or message back and forth to coordinate schedules, all sessions across ANU start strictly on the hour (e.g., 9:00 AM, 10:00 AM, 11:00 AM) and follow a universal 50-minute focus / 10-minute break cadence."

([61b9ec3](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/61b9ec3c036612200a120a58a9fd35e075b2786f))

this creates an overall clearer, easier to use workflow for better user onboarding.

2. **Deliverable ticket** upon joining a session:
> "The 60-Character "Deliverable Ticket"
> How it works: To unlock the "Board Session" button, the student must type a concrete, verifiable micro-goal capped at 60 characters ... Once paired, both partners' tickets remain visible on screen for the entire 50 minutes.

3. **Individual working time**, followed by **Interactive Breakouts**, based on earlier discussion with the TA during the crit:
> "The 15/35 Split-Phase Gate (Active Collab Modes Only)
> How it works: In Problem-Solving Mode, the 50-minute clock automatically locks the first 15 minutes into an amber Solo Retrieval Phase where talking is prohibited. At minute 15, a soft haptic pulse shifts the screen accent to green, unlocking the 35-minute Collaborative Synthesis Phase.

5. **User activeness**. Earlier iterations used strict tab-switch monitoring, but this hindered multitasking across windows. I replaced it with background activity tracking and periodic pop-up check-ins, allowing engagement monitoring without disrupting workflow.
> "An issue with the current 'inactivity': It does not allow users to switch tabs, which students often do (i.e., if they code, etc). I want to implement the following:
> As we can't always track tab visibility (because they should be in other tabs), how do we prevent social loafing and ensure they haven't just walked away from their laptop?
> We replace the hard 'inactivity' tracking we currently have implemented with Micro-Check-Ins.
> The Mechanic: Twice during the 50-minute block ... checks that the user is still active on their computer (the computer is not idle or sleep)."

([367b0a6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/367b0a61d995db1ea54e542215d4fe2cad9e10ca))

6. **Self-reflection at the end of a session**
> "Guided Meta-Breaks (SSRL Integration): To address the lack of structural improvement in standard SUAW sessions, the 10-minute break begins with a 90-second modal. This prompts ... before unlocking the remaining time for unstructured socializing."

7. **Strava-style Gamification** with user stats (i.e., Verified Focus Hours (VFH)), and _Kudos_. 
> "The "Deep Work Velocity" Receipt & Reliability Score (strava style)
> How it works: Instead of childish gamification (streaks, coins, or public leaderboards), the profile tab tracks two utility metrics: a Show-Up Reliability % (flaking drops you below 80% and restricts advance booking) and a Personal Velocity Log showing how many tickets you complete per hour at each ANU library.

Aside from addressing the _persistence_ requirement of the project, these adresses user accountability.

## Final design choices
The app was designed with simplicity in mind, for which the agent brainstormed ideas:
> "Lastly, I would like a redesign as I find the current design quite flat. I would like a design more closely resemble the productive app Notion. Please search the internet and see what design from Notion can be implemented. Give me a comprehensive, detailed breakdown."

The final design choices include:
1. **Simple timer:** The timer intentionally ommits ticking seconds to prevent unecessary distration to the user.

2. **Consistent color-coding:** amber, sage, and terracota, with simple light/dark chrome theme of the background.

3. **Typography:** Monospace fonts (`SF Mono`, `JetBrains Mono`) were chosen for simplicity and consistency across the app.


## Stack choices
**Backend:** Express + Socket.IO + node:sqlite ([8d2402c](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/8d2402ccfa4fe5e6f9c4999954f0037241777823)).
Socket.IO enables server-initiated phase updates without client requests, while `node:sqlite` provides was sufficient for a small project without requiring a dedicated database server.

**Frontend:** Initially vanilla-JS was used. This became hard to maintain as more functionality was added (i.e., ways of working), since each new phase meant another manual code update. The frontend was then migrated to React, Vite, and Tailwind.

## Agentic workflow
Throughout the project, I refined my ideas with initial self-research. From this, I then gathered several features that I would like. 

I passed these to the agent in Plan mode, for further refinement. After iterative planning, the agent built the code.

At each step of the process, I requested the agent to construct specific test cases. For example:

> "make some test scripts to test all the functionality and outline what you have done in this redesign"

A main drawback observed with the agentic flow is that agent is quick to recommend features, which may be superfluous. It is crucial, therefore, to really constrain the initial feature ideation of the agent.

At each step, I requested the summaries of what has been done, ensuring the development is on-track and the ideas are throroughly checked: 

> "give me a summary of the features that have been implemented. And the step-by-step guide on the flow of the app in various scenarios"

This prevented the agent from hallucinating out-of-scope features. I.e., complex voting behaviour, which was proposed by the agent in early prototype designs:
> From the agent's own approved plan, "Guided Pod Flow: Leader, Kickoff/Debrief/Vote, Stuck Queue, Whiteboard, 5-min start cadence":
> "Leader gates exactly two actions: `room:launch-whiteboard` (Problem-Solving, during Collab) and `room:initiate-vote` (during Break)... and among those cast, yes > no."

I decided to do this iterative development, as I observed Claude is not very good working on large chunks of a project at once. 

## Trade-off
The main trade-off of this workflow is a slower development process, as I first had to research and define the app's scope and features manually, rather than relying on the agent to ideate from scratch.

However, this deliberate approach helped keep development focused, avoid the AI slop seen in earlier critiques, and use credits more efficiently. It also reflects good software engineering practice: despite using an agentic workflow for most of the implementation, I retain ownership of the product and fully understand how it works.


