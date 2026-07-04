---
description: Ask Codex to research a question read-only (with web search) and report findings
argument-hint: '[--wait|--background] [-m <model>] [--effort <e>] <question>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Delegate a research question to Codex. Codex runs **read-only** with web search enabled — it investigates the code and the web and reports findings, but changes nothing.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- Read-only. Codex must not edit files. This is for investigation, root-cause analysis, comparing approaches, or gathering external context.
- Your job is to run it and return the findings verbatim — do not act on them in the same turn.

Execution (backgrounding is Claude Code's job):
- The command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" research "$ARGUMENTS"
```
- Default to **background**:
```typescript
Bash({ command, description: "Codex research", run_in_background: true })
```
  Tell the user it's running; surface it with `BashOutput` and you'll be notified on completion. No plugin status command exists or is needed.
- If the args include `--wait`, run it in the **foreground** (generous `timeout`, up to 600000ms) and stream the result.

Output rules:
- Return Codex's findings exactly as-is, preserving its structure (observed facts, inferences, open questions, next steps).
- Keep any uncertainty or inference markers Codex included.
- Do not implement anything based on the research without the user asking first.
