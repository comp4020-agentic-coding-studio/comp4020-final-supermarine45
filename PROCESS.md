# Process overview

## What I built
The app, “Shut Up and Read“, is inspired by the “Shut Up and Write“ initiative run by the ANU Student Association (ANUSA). Its main purpose is to help students find reading or study partners and work together in a focused environment.

As a productivity app, the interface is deliberately kept simple, with two core functions: finding study or reading groups across campus and using a Pomodoro-style countdown timer to structure study sessions and help users stay focused and accountable. User activities are logged in the backend to generate summary statistics. For the purposes of this crit, the prototype has a limited feature set, with further development planned.

## Process
Initially, I started with a more complex concept that integrated several features, including a “study coach” recommender system that would actively guide users through their study sessions.

However, I found that the agent was less effective when given large, complex prompts and asked to build multiple features at once. I therefore decided to start with a lightweight, functional prototype focused on two core functions: a study timer and a study group feature.

(cite commit)

From this initial prototype, I iteratively added further features:

(cite prompt, cite prompt, cite prompt)

At this point, the prototype had fulfilled the requirements for Crit 8. However, I decided to further develop it by adding several features, including a dedicated login page:

(cite)

One feature I initially considered was building a wrapper for booking study spaces through the ANU Library portal. However, in keeping with the assignment brief, I decided to keep the prototype focused on its core purpose rather than expanding its feature set unnecessarily. I therefore adopted an iterative approach, leaving this feature as a potential area for future development.

Another challenge I encountered with the agentic workflow was reliably testing the Crit requirements, particularly persistent requirement. To address this, I created a dedicated test to verify these requirements:

(cite prompt)

As more features are added, I will continue to develop and expand the test suite accordingly.


can you fill the citation in process.md? Don't change the text itself.

