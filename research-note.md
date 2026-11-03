Agentic software development shifts the role of a developer into an increasingly instructional one. Traditional software engineering requires a developer to be involved at all step of a product development, from requirements gathering, architectural design, to code implementation and debugging. Through Agentic LLM such as Claude, however, the developer’s role is often reduced into product design, without having to implement code itself. This framework accelerates code development, allowing developers to ship features quickly. 

In this new way-of-working, it is crucial to understand how agentic AI works, to avoid falling into the trap of superfluous code generation (Willison, 2026), and incurring cognitive debt (Storey, 2026). I.e., the lack of understanding of the generated product. In such cases, the system, though working, becomes a “black-box” which the developers could not understand (Storey, 2026); thus, making it difficult for developers to convey their intentions. 

It can be argued that such cognitive debt results in a loss of code quality. Though agents are able to produce a “working code”, they often lack coherence (Ronacher, 2026). LLMs are able to implement code, but not necessarily assess them, this creates concerns about code design (Osmani, 2026), and whether there is a disconnect between the developer’s intended specification and the product. The Goodhart's Law (Strathern, 1997) further illustrates this notion: when passing unit tests becomes the target, an agent may produce covoluted solutions to simply pass the tests, rather than addressing the underlying engineering problem of verifying, explaining, and understanding of the system.  This disjoint between apparent efficiency and quality is illustrated in Yegge’s experiment of an “industrialized coding factory”, which agents produced a large amount complex code, which eventually becomes hard to verify (2026).

A counterargument, however, is that cognitive debt and the associated degradation in code quality can be mitigated through appropriate engineering practices. One such approach is harness engineering (e.g., claude.md), automated testing, and backpressure. A harness effectively provides a feedback mechanism that constrains and evaluates an agent's outputs before they are incorporated into the final product. From this perspective, sufficient harnesses could compensate for some of the technical oversight traditionally performed by developers. Combined with sufficiently large context windows (Karpathy, 2025), agentic workflows could potentially achieve code quality comparable to that of human developers.

Nevertheless, I argue that these mitigations do not address the core problem of agentic software development. As Klabnik highlights, attempting to replace software engineering with automated prompting is "aggressively not rigorous" (2026). Similarly, Narayanan's (2026) ICML keynote emphasises a lack of normative judgement, which remains a fundamental limitation in an agentic workflow. As automated agents do not distinguish between conventions and mere habits (Böckeler, 2026), they cannot be entirely relied upon to self-evaluate. The central issue is that developers who lack an understanding of the systems they are building may also lack the capacity to design effective tests, construct appropriate harnesses, or identify shortcomings in an agent's implementation. In other words, the effectiveness of these safeguards is itself dependent on the developer's technical understanding. This suggests that AI agents should be approached through a human-in-the-loop framework (Shneiderman, 2020), rather than as an outright replacements for software engineering.

At heart, effective agentic software development and the management of cognitive debt are inherently connected. As agentic development becomes increasingly prevalent, the challenge is not to resist its usage, but to manage expectations around the role of human engineers. Developers must remain more than prompt writers: they must retain the judgement, control, and technical understanding necessary to direct and evaluate their agents. Accordingly, agentic software development should be treated as a complement to human engineering, rather than a replacement for it. This also implies a shift in the developer's role towards higher-level conceptual and architectural responsibilities (Narayanan, 2026), while retaining sufficient technical depth to evaluate the resulting implementation. Only through this balance can software developers preserve the integrity, code quality, and ownership of their work.

**References: **
Böckeler, B. (2026). Harness engineering for coding agent users. Martin Fowler. https://martinfowler.com/articles/harness-engineering.html

Klabnik, S. (2026, January 15). How to think about Gas Town. Steve Klabnik. https://steveklabnik.com/writing/how-to-think-about-gas-town/

Narayanan, A. (2026, July 9). What will be left for us to work on? [Invited keynote presentation]. International Conference on Machine Learning (ICML), Seoul, South Korea. https://www.cs.princeton.edu/~arvindn/talks/icml-2026-annotated-slides/

Osmani, A. (2026, August 8). Agentic code quality. Addy Osmani. https://addyosmani.com/blog/agentic-code-quality/

Ronacher, A. (2026, June 23). The Coming Loop. Armin Ronacher's Thoughts and Writings.https://lucumr.pocoo.org/2026/6/23/the-coming-loop/

Shneiderman, B. (2020). Human-centered artificial intelligence: Reliable, safe & trustworthy. International Journal of Human–Computer Interaction, 36(6), 495–504. https://doi.org/10.1080/10447318.2020.1741118

Storey, M.A. (2026, February 9). How generative and agentic AI shift concern from technical debt to cognitive debt. https://margaretstorey.com/blog/2026/02/09/cognitive-debt/

Strathern, M. (1997). ‘Improving ratings’: Audit in the British university system. European Review, 5(3), 305–321. https://doi.org/10.1002/(SICI)1234-981X(199707)5:33.0.CO;2-4

Willison, S. (2026, February 23). Writing code is cheap now. In Agentic Engineering Pattern. Simon Willison's Weblog. https://simonwillison.net/guides/agentic-engineering-patterns/code-is-cheap/

Yegge, S. (2026). Welcome to Gas City. Steve Yegge. https://yegge.ai/essays/welcome-to-gas-city/



