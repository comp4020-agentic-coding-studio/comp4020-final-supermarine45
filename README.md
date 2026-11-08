# What I built: Shut Up and Read
**Shut Up and Read** is a productivity app inspired by ANUSA's *Shut Up and Write* (SUAW) initiative. It brings students together for focused writing sessions using the Pomodoro Technique: 50 minutes work followed by 10-minute break:

https://web.archive.org/web/20230305234720/https://thesiswhisperer.com/shut-up-and-write/

Building on this, the project creates a digital platform connecting students across campus for structured group study sessions while preserving individual focus time.

## Target User:
The app is designed for ANU students, who can choose from four *Ways of Working*, depending on their study objectives:

- **Silent Focus:** Individual work for the full 50 minutes, without breakouts or discussions.
- **Writing Clinic:** Individual drafting for 40 minutes, followed by a 10-minute peer-feedback session in a breakout room.
- **Concept Pitch:** Individual preparation for 40 minutes, followed by a 10-minute brainstorming session in a breakout room.
- **Problem-Solving:** Individual problem-solving for 40 minutes, followed by a 10-minute collaborative session to solve and check answers using a shared whiteboard.

## Observed Problem:
The idea stemmed from my difficulty finding study partners or organising study groups (i.e., *organising costs* concept, (Kirschner, Paas, & Kirschner, 2011)).

Moreover, simply bringing students together does not guarantee productive collaboration. In discussion with the TA, it was highlighted that ANUSA's existing SUAW initiative does not sufficiently facilitate interaction between participants (e.g., discussing study tips).

In response to this feedback, and following the project's multi-user requirements, I designed these principles:

1. **Self-reflection**

   Each 10-minute discussion session begins with a 90-second reflection prompt. This encourages students to identify their individual *bottlenecks* before engaging in group discussion. For example: "What was the most challenging structural issue in your draft?"

2. **Dedicated Individual Work Time**

   Though group work can be motivating, working exclusively in a collaborative setting can hinder individual performance, a cognitive phenomenon known as *collaborative inhibition*. Drawing on research into collaborative work design (Gyollai, 2025), the app therefore preserves dedicated individual work periods before introducing collaborative activities.

3. **Deliverable Tickets**

   Unstructured group work can lead to *social loafing*, whereby individuals reduce their effort when working collectively ((Karau & Williams, 1993), (Ghaleb, 2024)). To mitigate this and keep individual accountability, students are prompted to submit a *Deliverable Ticket* outlining their intended contribution to the group's objectives before each session. 

4. **Interactive Breakout Sessions**

   Rather than relying on passive interaction, the app incorporates structured breakout activities that require active participation. For example, the *Writing Clinic* mode facilitates peer-review exchanges, allowing students to swap their drafts and provide feedback to one another.

## The Idea
Beyond these core features, the app's design also considers several practical challenges that could affect students' ability to participate consistently and maintain focus.

1. **User Activeness**

   To encourage accountability, the app tracks users' *activeness* through periodic check-in notifications and individual activity statistics (in _Strava_ style), such as the number of study hours logged.

2. **Reducing Organising Costs**

   Organising a group study session can be inconvenient. To reduce this barrier, the app aims to make onboarding as frictionless as possible. Students can *drop in* to an ongoing study session, either with or without creating an account.

3. **Minimising Distractions**

   A full-window application running in the foreground could become distracting or disrupt students' existing workflows. To address this, the interface uses a compact pop-up window with a timer displaying only minutes. This allows students to keep the app running in the background while continuing their work.

4. **Limiting Visual and Social Distractions**

   To retain focus during individual time, multi-user interactions are deliberately restricted to lightweight actions (e.g., sending _Strava_ styled *Kudos*). This allows students to encourage one another without interrupting their workflow.

In addition to the user-facing features, I implemented a logging system:

1. **System:** Tracks currently logged-in users.
2. **Activity:** Records user activities and interactions.
3. **Status:** Monitors the server's operational status.


## What I chose NOT to built
- **Strict Tab-tracking.** Earlier builds penalised a user for switching tab (i.e., getting distracted), which is counterintuitive should the user need to work actively (in another tab).
- **A phone layout.** The app is designed to be in a library (desk-setting). As such, it is optimized for desktop viewing, instead of a phone.



* references found in references.md.

