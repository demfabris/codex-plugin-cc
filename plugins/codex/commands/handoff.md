---
description: Hand an implementation task to Codex with full write access to the repo
argument-hint: '[--wait|--background] [--resume] [--full-access] [-m <model|spark>] [--effort <e>] <task>'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Hand an implementation task to Codex. Codex runs with **workspace write access** and web search, so it can edit files and run commands in this repo to complete the task.

Raw slash-command arguments:
`$ARGUMENTS`

What this does:
- Forwards the task to `codex exec` (write-capable). Codex may create, edit, and delete files and run sandboxed commands.
- `--full-access` upgrades the sandbox to `danger-full-access` (no sandbox, network + full FS). Only use it when the user explicitly asks.
- `--resume` continues the most recent Codex session in this repo instead of starting fresh (good for "keep going", "apply the top fix", "dig deeper"). Any trailing text becomes the follow-up instruction.
- `-m <model>` / `--effort <e>` are optional. `spark` maps to `gpt-5.3-codex-spark`. Leave them unset unless the user asks.

Execution (let Claude Code own the backgrounding):
- The command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" handoff "$ARGUMENTS"
```
- Default to **background** — implementation runs are long and you often fire several at once:
```typescript
Bash({ command, description: "Codex handoff", run_in_background: true })
```
  Report that the handoff is running in the background. Read progress with `BashOutput`; you'll be notified when it exits. To run several handoffs in parallel, launch each as its own background Bash shell and track them with `BashOutput` — do not route them through any plugin job board.
- If the args include `--wait`, run it in the **foreground** (generous `timeout`, up to 600000ms) and stream the result.

Output rules:
- Return Codex's output verbatim. Do not re-implement, second-guess, or "finish" Codex's work yourself.
- Because Codex writes to the tree, after it finishes note which files changed (`git status --short`) so the user can review the diff.
- If Codex was never invoked or failed, report the failure and stop — do not silently substitute your own implementation.
