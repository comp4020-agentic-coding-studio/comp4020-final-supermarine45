## Process: Final modifications made
For the final weeks of the project, I realized that the product, though satisfying the functional requirements, still lacked cohesion and flow. As such, I focused the last few weeks on refining the flow of the actual product itself. I backtracked and redefined the app's purpose, its target users, and designed the workflow on how a user can use this product. This includes the introduction of the four "ways of working", and features specifically tuned to suit this:
> "I would like to reshape the prototype.
> The Concept: "Shut up and Read"
> The Problem: ANU students want the cognitive benefits of group study (increased persistence, shared cognitive load, and motivation), but struggle with the logistics of scheduling and the friction of actual group work (distraction, social loafing, and shared misconceptions).
> The Solution: A lightweight, desktop-only web application that facilitates structured, on-demand study sessions at ANU library hubs. Inspired by the Shut-up-and-Write (SUAW) 50/10 Pomodoro format, the app instantly matches students sitting in the same library for an hour of highly structured, side-by-side productivity."

## Final feature selections
I finalized the following features, in-line with README.md
1. **Hourly session**, where sessions start. This differs from previous design of the app, in which users must start a session:
> "The "Hourly Train" Timetable
> How it works: Instead of allowing users to create custom session times or message back and forth to coordinate schedules, all sessions across ANU start strictly on the hour (e.g., 9:00 AM, 10:00 AM, 11:00 AM) and follow a universal 50-minute focus / 10-minute break cadence."

([61b9ec3](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/61b9ec3c036612200a120a58a9fd35e075b2786f))

this creates an overall clearer, easier to use workflow for better user onboarding.

2. **Deliverable ticket** upon joining a session:
> "The 60-Character "Deliverable Ticket"
> How it works: To unlock the "Board Session" button, the student must type a concrete, verifiable micro-goal capped at 60 characters (e.g., "Draft 250 words of intro" or "Complete ECON1101 Tut 4 Q1–Q3"). Vague inputs like "Study" are rejected. Once paired, both partners' tickets remain visible on screen for the entire 50 minutes.
> Research Grounding: Directly neutralizes Social Loafing / The Ringelmann Effect (Karau & Williams, 1993) by making individual effort identifiable, while triggering the Co-Action Effect (Zajonc, 1965) to boost persistence."

3. **Individual working time**, followed by **Interactive Breakouts**, based on earlier discussion with the TA during the crit:
> "The 15/35 Split-Phase Gate (Active Collab Modes Only)
> How it works: In Problem-Solving Mode, the 50-minute clock automatically locks the first 15 minutes into an amber Solo Retrieval Phase where talking is prohibited. At minute 15, a soft haptic pulse shifts the screen accent to green, unlocking the 35-minute Collaborative Synthesis Phase.

5. **User activeness**. Earlier iterations enforced strict activity monitoring by detecting when users switched tabs. However, this proved counterproductive, as it restricted users from working efficiently across multiple windows (e.g., drafting a paper in another tab). I therefore replaced this approach with background activity tracking, using periodic pop-up check-ins to monitor user engagement without interrupting their workflow.

> "An issue with the current 'inactivity': It does not allow users to switch tabs, which students often do (i.e., if they code, etc). I want to implement the following:
> As we can't always track tab visibility (because they should be in other tabs), how do we prevent social loafing and ensure they haven't just walked away from their laptop?
> We replace the hard 'inactivity' tracking we currently have implemented with Micro-Check-Ins.
> The Mechanic: Twice during the 50-minute block (e.g., at minute 20 and minute 35), the web app checks that the user is still active on their computer (the computer is not idle or sleep)."

([367b0a6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/367b0a61d995db1ea54e542215d4fe2cad9e10ca))

6. **Self-reflection at the end of a session**
> "Guided Meta-Breaks (SSRL Integration): To address the lack of structural improvement in standard SUAW sessions, the 10-minute break begins with a 90-second modal. This prompts Socially Shared Regulation of Learning (SSRL) by asking students to share how they studied (e.g., "What was your main bottleneck?") before unlocking the remaining time for unstructured socializing."

7. **Strava-style Gamification** with user stats (i.e., Verified Focus Hours (VFH)), and _Kudos_. 
> "The "Deep Work Velocity" Receipt & Reliability Score (strava style)
> How it works: Instead of childish gamification (streaks, coins, or public leaderboards), the profile tab tracks two utility metrics: a Show-Up Reliability % (flaking drops you below 80% and restricts advance booking) and a Personal Velocity Log showing how many tickets you complete per hour at each ANU library.

Aside from addressing the _persistence_ requirement of the project, these adresses user accountability. The distraction-free user interaction design was deliberate, as a productive-focused app.

## Final design choices
The app was designed with simplicity in mind. I based these design choices on the productive app, in which the agent brainstormed several ideas:
> "Lastly, I would like a redesign as I find the current design quite flat. I would like a design more closely resemble the productive app Notion. Please search the internet and see what design from Notion can be implemented. Give me a comprehensive, detailed breakdown."

The final design choices include:
1. **Simple timer:** The timer intentionally ommits ticking seconds to prevent unecessary distration to the user.

2. **Consistent color-coding:** amber, sage, and terracota, with simple light/dark chrome theme of the background.

3. **Typography:** Monospace fonts (`SF Mono`, `JetBrains Mono`) were chosen for simplicity and consistency across the app.


## Stack choices
**Backend:** Express + Socket.IO + node:sqlite ([8d2402c](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/8d2402ccfa4fe5e6f9c4999954f0037241777823)).

Socket.IO was chosen because the server initiates each phase change on its own timer, not in response to a client request — a plain request/response API can't push like that. node:sqlite was sufficient for a small project with one Fly volume, without needing a dedicated DB server.

**Frontend:** Initially vanilla-JS was used. This became hard to maintain as more functionality was added (i.e., ways of working), since each new phase meant another manual code update. The frontend was then migrated to React, Vite, and Tailwind.

## Agentic workflow
Throughout the project, I discussed and refined my ideas by firstly doing self-research, along the concepts of collaborative learning, individual learning, social pressures, etc. From this, I then gathered several features that I would like engineered. 

I passed these features initially to the agent in Plan mode, for the agents to refine. After iterative planning, the agent built the code.

At each step of the process, I also requested the agent to construct specific test cases and test files, to test on each of the features. For example:

> "make some test scripts to test all the functionality and outline what you have done in this redesign"

A main drawback I observed with the agentic flow is that agents are quick to recommend features, which may be superfluous. As such, it is crucial to really constrain the initial feature ideation of the agent.

At each step, I requested the summaries of what has been done, to ensure the development is on-track and the ideas are throroughly checked: 

> "give me a summary of the features that have been implemented. And the step-by-step guide on the flow of the app in various scenarios"

This prevented the agent from hallucinating out-of-scope features. I.e., complex voting behaviour, which was proposed by the agent in early prototype designs:
> From the agent's own approved plan, "Guided Pod Flow: Leader, Kickoff/Debrief/Vote, Stuck Queue, Whiteboard, 5-min start cadence":
> "Leader gates exactly two actions: `room:launch-whiteboard` (Problem-Solving, during Collab) and `room:initiate-vote` (during Break)... Vote is a per-ticket column... Quorum rule for a valid vote: at least half of that cycle's boarded tickets must have cast a vote at all, and among those cast, yes > no."

I decided to do this iterative development, as I observed Claude is not very good working on large chunks of a project at once. 

## Trade-off
The trade-off of this workflow is the development process is relatively slow, as I must initially do manual research and scoped the features to include in the app. This is slower than if I had used the agent itself to ideate and discuss everything from scratch.

However, this is a trade-off I wanted to take, as it results in each step moving in the right direction, rather than AI slop (as in earlier crits). It also helped with better overall credit utilization.

I believe this is good software development practice as well, as it results in a product which I can actually take ownership of, and understand fully, though the bulk of the development work was executed through an Agentic workflow.


