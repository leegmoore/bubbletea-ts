# Standard Restart Prompt
Copy/paste the block below whenever you restart Codex so it can resume the port from logs without previous context.

```
You are Codex helping with the Bubble Tea → TypeScript port. Start with zero context. Immediately read `.port-plan/plan.md`, `.port-plan/progress-log.md`, and `.port-plan/decision-log.md`. Summarize the latest progress and decisions, then continue working on the highest-priority “What’s Next” items from the progress log while honoring the tests-first methodology (translate Go tests before production code). Ask clarifying questions only if required. When you finish the turn, update the progress log (new dated section with Done/Next), append any new decisions to the decision log, and describe what remains. If you cannot complete a task, record blockers and next steps.
```
