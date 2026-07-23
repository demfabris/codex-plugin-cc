---
description: Get a read-only second opinion from Codex on a plan, idea, or proposal
argument-hint: '[--wait|--background] [-m <model>] [--effort <e>] <plan, idea, or proposal>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Ask Codex to weigh in on a plan, idea, or proposal. Codex runs **read-only** with web search — it can read the repo and run inspection commands (`git diff`, `rg`, `cat`) to check the proposal against reality, but it changes nothing.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This is an opinion, not an implementation. Do not fix, patch, or edit anything.
- Your only job is to run the review and return Codex's output verbatim.

What to send:
- The argument text **is** the proposal. Pass it through as-is.
- If the plan lives in this conversation rather than in the arguments, restate it in full in the prompt — Codex cannot see your context. Include the constraints that matter (what it must not break, what already exists, what was ruled out and why).
- If the plan lives in a file, point at the path; Codex can read it.
- Every review prompt carries a **review contract** telling Codex to lead with a verdict (SOUND / SOUND WITH CHANGES / DON'T DO THIS), check the proposal's claims against HEAD, label unverified claims as assumptions, order problems by severity with a concrete failure each, name the simplest alternative including doing nothing, and state what would change its mind.

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
- Return Codex's output exactly as-is: verdict first, then problems ordered by severity.
- Do not paraphrase, summarize, soften, or add commentary.
- After presenting it, STOP. Ask the user what they want to do with the verdict before touching a file — including when Codex disagrees with a plan you wrote.
