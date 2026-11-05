# Process overview

## What I built
This week’s crit is focused on implementing a logging mechanism for multi-user. I implemented this with the following design choices:
1. 'Accountability' tracking. The app tracks each user, and whether they're actively present during the 'focus time'. Should they switch windows or tab for more than a determined time, the server will log that the user is no longer presence in the session.
2. Unique session ID assigned to the users.

## Process
The process started by brainstorming ideas on how to represent 'logs who did what'. I implemented basic session ID to each user, as well as proper server-side logging. Moreover, I would like to add logging features to log certain activities of the users. This is firstly done through implementing 'accountability'. I.e., a logging that tracks whether a user is active in a session, or if they're away:
([8c6e30a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/8c6e30a))

I also implemented additional logging to record when users join a focus session, including whether they join at the beginning or partway through an ongoing session 

> "implement the following logging: 1. logging on the time a user joins a focus session (i.e., if they join in the middle of a session, etc). 2. logging on the voting behaviour of the users."

as well as logging on users’ voting behaviour to better capture and analyse the multi-user dynamics of the prototype 

([b8bcc51](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/b8bcc51)).

Finally, I refined the logging system to capture system status events, such as errors and warnings, and categorised the logs into three distinct types: basic session logging, feature-related logging, and system status logging. This separation improves the organisation and interpretability of the logs, making it easier to monitor user activity, understand feature usage, and identify potential system issues.

> "can you split the logging into system logging (when a user joins or leaves) and activity logging (related to the features of the actual system)?"
> "can you show the logging of the system as well (warning, error, etc), with proper log status? This should fall under a seperate 'status' logging"
([33bd797](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/33bd797), [be6f2f2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/be6f2f2))

Lastly, these functionalites were subsequently tested using built-in tests:

> "create a test to test multi user activity and the corresponding logging."
([f39dc7c](https://github.com/comp4020-agentic-coding-studio/comp4020-final-supermarine45/commit/f39dc7c))

