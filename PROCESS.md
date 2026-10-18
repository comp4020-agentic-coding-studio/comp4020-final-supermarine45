# Process overview

## What I built
This week’s crit is focused on implementing a logging mechanism for multi-user. I implemented this with the following design choices:
1. 'Accountability' tracking. The app tracks each user, and whether they're actively present during the 'focus time'. Should they switch windows or tab for more than a determined time, the server will log that the user is no longer presence in the session.
2. Unique session ID assigned to the users.

## Process
The process started by brainstorming ideas on how to represent 'logs who did what'. Firstly, I implemented basic session ID to each user, as well as proper server-side logging:

(cite prompt, cite)

To ensure that the 

Next, I would like to add logging features to log certain activities of the users. This is firstly done through implementing 'accountability'. I.e., a logging that tracks whether a user is active in a session, or if they're away:

(cite, cite)

I decided to also implement an additional logging on the time a user joins a focus session (i.e., if they join in the middle of a session, etc).

(cite)

as well as a logging on the voting behaviour of the users, to highlight the multi-user aspect of the prototype.

Lastly, these functionalites were subsequently tested using built-in tests:

