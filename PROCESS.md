## Process: Final modifications made
For the final weeks of the project, I realized that the product, though satisfy the functional requirement, still lacked cohesion and flow. As such, I focused the last few weeks on refining the flow of the actual product itself. I backtracked and redefined the app's purppose, its target users, and design the workflow on how a user can use this product. This includes the introduction of the four "ways of working", and features specifically tuned to suit this.

## Final feature selections


## Final design choices

## Stack choices

## Agentic workflow
Throughout the project, I discussed and refined my ideas by firstly doing self-research, along the concepts of collaborative learning, individual learning, social pressures, etc. From this, I then gathered several features that I would like engineered. 

I passed these features initially to the agent in Plan mode, for the agents to refine. After iterative refinement, the agent build the code. This resulted in the initial prototype:
(cite)
At each step of the process, I also requested the agent to construct specific test cases and test files, to test on each of the features:
(cite)

A main drawback I observed with the agentic flow, is that agents are quick to recommend features, which may be superflous. As such, it is crucial to really constrained the initial feature ideation of the agent.

Moreover, I requested at each step, the summaries of what has been done, to ensure the development is on-track:
(cite)

I decided to do this interative development, as I observed Claude is not very good working on large chunks of a project at once. I had to therefore, breakdown each step.


## Trade-off

The trade-off of this workflow is the development process is relatively slow. In particular, as I must initially do manual research and make notes on what specific features and workflow I would like in the app. This is notably slower than if I had used the agent itself to ideate and discuss.

However, this is a trade-off I was willing to take, as it results in: less credit being used at each step, each step is moving at the right direction.

I belive this is a good software development practice as well, as it results in a product which I can actually take ownership of, and understand fully, though the development work was done through Agentic workflow.

