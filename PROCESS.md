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

I also implemented additional logging to record when users join a focus session, including whether they join at the beginning or partway through an ongoing session 

(cite prompt).

Additionally, I introduced logging for users’ voting behaviour to better capture and analyse the multi-user dynamics of the prototype 

(cite prompt).

Finally, I refined the logging system to capture system status events, such as errors and warnings, and categorised the logs into three distinct types: basic session logging, feature-related logging, and system status logging. This separation improves the organisation and interpretability of the logs, making it easier to monitor user activity, understand feature usage, and identify potential system issues.

(cite prompt, cite commit)

Lastly, these functionalites were subsequently tested using built-in tests:

