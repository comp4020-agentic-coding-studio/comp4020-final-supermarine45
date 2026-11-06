## Process: Final modifications made
For the final weeks of the project, I realized that the product, though satisfying the functional requirements, still lacked cohesion and flow. As such, I focused the last few weeks on refining the flow of the actual product itself. I backtracked and redefined the app's purpose, its target users, and designed the workflow on how a user can use this product. This includes the introduction of the four "ways of working", and features specifically tuned to suit this. The workflow were designed as follows:
(cite prompt)

## Final feature selections
I finalized the following features, in-line with README.md
1. **Hourly session**, where sessions start. This differs from previous design of the app, in which users must start a session:
(cite prompt, cite commit)

this creates an overall clearer, easier to use workflow for better user onboarding.

2. **Deliverable ticket** upon joining a session:
(cite prompt)

3. **Individual working time**, followed by **Interactive Breakouts**, based on earlier discussion with the TA during the crit:
(cite prompt)

5. **User activeness**. Earlier iterations enforced strict activity monitoring by detecting when users switched tabs. However, this proved counterproductive, as it restricted users from working efficiently across multiple windows (e.g., drafting a paper in another tab). I therefore replaced this approach with background activity tracking, using periodic pop-up check-ins to monitor user engagement without interrupting their workflow.

(cite prompt, cite commit)

6. **Self-reflection at the end of a session**
(cite prompt)

to address the lack of _feedback_ aspect of the current ANUSA's _SUAW_ program.

7. **Strava-style Gamification** with user stats (i.e., Verified Focus Hours (VFH)), and _Kudos_. 
(cite prompt, cite commit)

Aside from addressing the _persistence_ requirement of the project, these adresses user accountability. The distraction-free user interaction design was deliberate, as a productive-focused app.

## Final design choices
The app was designed with simplicity in mind. I based these design choices on the productive app, in which the agent brainstormed several ideas:
(cite prompt)

The final design choices include:
1. **Simple timer:** The clock intentionally hides ticking seconds (e.g., displaying only `42m`) to prevent unecessary distration to the user.

2. **Consistent color-coding:** (Fill the color here), for consistency.

3. **Typography:** Simple monospace fonts (`SF Mono`, `JetBrains Mono`) were used consistenty across the app.


## Stack choices
The project utilized the following stackL
* **Frontend:** React / Next.js (ADD why).
* **Styling & Animation:** Tailwind CSS (ADD why).
* **Real-time Syncing:** Socket.IO used to manage session countdown, active user tracking, and real-time whiteboard discussions. 
* **Testing:** Vitest for the spec suite (evaluating server state) and Playwright for smoke testing the functional flows. 

## Agentic workflow
Throughout the project, I discussed and refined my ideas by firstly doing self-research, along the concepts of collaborative learning, individual learning, social pressures, etc. From this, I then gathered several features that I would like engineered. 

I passed these features initially to the agent in Plan mode, for the agents to refine. After iterative planning, the agent built the code. This resulted in the initial prototype: 

(cite)

At each step of the process, I also requested the agent to construct specific test cases and test files, to test on each of the features. For example:

(fill example)
(add prompt and commit cite)

A main drawback I observed with the agentic flow is that agents are quick to recommend features, which may be superfluous. As such, it is crucial to really constrain the initial feature ideation of the agent.

At each step, I requested the summaries of what has been done, to ensure the development is on-track and the ideas are throroughly checked: 

(add prompt cite)

This prevented the agent from hallucinating out-of-scope features. I.e., complex voting behaviour, which was proposed by the agent in early prototype designs:
(cite plan)

I decided to do this iterative development, as I observed Claude is not very good working on large chunks of a project at once. 

## Trade-off
The trade-off of this workflow is the development process is relatively slow. In particular, as I must initially do manual research and make notes on what specific features and workflow I would like in the app. This is notably slower than if I had used the agent itself to ideate and discuss everything from scratch.

However, this is a trade-off I was willing to take, as it results in each step moving in the right direction, rather than AI slop (as in earlier crits). It also helped with better overall credit utilization.

I believe this is a good software development practice as well, as it results in a product which I can actually take ownership of, and understand fully, though the bulk of the development work was executed through an Agentic workflow.


