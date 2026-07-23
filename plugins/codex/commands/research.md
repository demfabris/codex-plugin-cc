---
description: Send Codex on a deep web search to compare approaches and tradeoffs for a problem
argument-hint: '[--wait|--background] [-m <model>] [--effort <e>] <problem or question>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Send a problem to Codex for a deep web pass. Codex runs **read-only** with web search enabled — it searches the web, reads the repo for context, and reports what approaches exist and what each one costs. It changes nothing.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- Read-only. Codex must not edit files. This is for surveying approaches, weighing tradeoffs, and gathering external context — not for implementing the answer.
- Your job is to run it and return the findings verbatim — do not act on them in the same turn.

What to send:
- State the **problem**, not just a keyword. Include the constraints that narrow the answer: the stack and versions in play, what the solution has to interoperate with, what has already been ruled out and why.
- Every research prompt carries a **research contract** telling Codex to actually search the web and cite primary sources with URLs, surface at least three genuinely distinct approaches (including the boring one and doing nothing), compare them in a tradeoff table, date its evidence and flag what it could not confirm is current, split observed facts from inference, and close with one recommendation plus the condition that would flip it.

Execution (backgrounding is Claude Code's job):
- The command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" research "$ARGUMENTS"
```
- Default to **background** — a deep web pass takes a while:
```typescript
Bash({ command, description: "Codex research", run_in_background: true })
```
  Tell the user it's running; surface it with `BashOutput` and you'll be notified on completion. No plugin status command exists or is needed.
- If the args include `--wait`, run it in the **foreground** (generous `timeout`, up to 600000ms) and stream the result.

Output rules:
- Return Codex's findings exactly as-is, preserving its structure (approaches, tradeoff table, sources, open questions, recommendation).
- Keep the citations and every uncertainty or inference marker Codex included. A tradeoff stripped of its source is just an opinion.
- Do not implement anything based on the research without the user asking first.
