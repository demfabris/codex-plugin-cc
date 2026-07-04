---
description: Run a read-only Codex code review (with web search) on your local git changes
argument-hint: '[--base <ref>|--commit <sha>] [--wait|--background] [-m <model>] [--effort <e>] [focus text]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run a read-only Codex review of the current repository. Codex has web search enabled so it can check docs, APIs, and advisories while reviewing.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only. Do not fix issues, apply patches, or edit anything.
- Your only job is to run the review and return Codex's output verbatim.

Target:
- Default target is the uncommitted working tree.
- `--base <ref>` reviews this branch against a base; `--commit <sha>` reviews one commit.
- Before running, sanity-check there is something to review: `git status --short --untracked-files=all` (and, for `--base`, `git diff --shortstat <base>...HEAD`). If it is clearly empty and no `--base`/`--commit` was given, say there is nothing to review and stop. When in doubt, run the review.

Execution (backgrounding is Claude Code's job, not the plugin's):
- The command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review "$ARGUMENTS"
```
- Default to **background** so a long review can't be killed by the foreground timeout:
```typescript
Bash({ command, description: "Codex review", run_in_background: true })
```
  Then tell the user the review is running in the background, and that you'll surface it with `BashOutput` (and be notified when it finishes). Do not poll any plugin status command — there is none.
- If the args include `--wait`, run it in the **foreground** instead (set a generous `timeout`, up to 600000ms) and stream the result.

Output rules:
- Return Codex's review output exactly as-is, findings first, ordered by severity.
- Do not paraphrase, summarize, or add commentary.
- After presenting findings, STOP. Do not fix anything. Ask the user which issues, if any, they want addressed before touching a file.
