# Process overview

## What I built
This week’s focus was on designing real-time interactions that are visible to everyone in a room, rather than only to the user who initiates them, and that persist across reconnections. Building on the existing timer, chat, and account functionality, I implemented group voting and simple interactions to support collaboration while keeping the app focused on productivity.

## Process
The process started by refining the project’s scope. In the previous crit, the key feedback was to establish a clearer focus on the app’s target users. Since the app is intended for ANU students, I focused on improving the layout and making the initial user experience more intuitive. I implemented two key changes:

1. **Restructured the page layouts** to better reflect the concept of shared study spaces and make the app’s purpose clearer.
2. **Improved accessibility and ease of use** by allowing anonymous visitors to access basic functionality without creating an account.

Next, I focused on multi-user interactions. Since the app is designed to support productivity, I wanted to minimise the interaction required from users while still making group dynamics visible. I therefore scoped this crit around three key functionalities:

1. **Group voting for focus duration:** Rather than allowing a single user to determine the length of a focus session, users can collectively decide on the duration through a voting mechanism.

2. **Group chat and encouragements:** Implemented group messaging and lightweight encouragements that users can send to one another during focus sessions, supporting social connection without unnecessarily disrupting concentration.
[6399bc4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/6399bc4)

3. **Concurrency handling:** Ensured that simultaneous start and voting requests are resolved consistently on an ordered, preventing conflicting outcomes across users.
([cc1955f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/cc1955f))

These functionalites were subsequently tested using built-in tests:
([1bbb9dd](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/1bbb9dd)).
