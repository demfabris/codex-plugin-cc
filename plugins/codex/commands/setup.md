---
description: Check whether the local Codex CLI is installed and authenticated
argument-hint: ''
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Check that Codex is ready to use. This runs `codex doctor`, which diagnoses the install, authentication, config, and runtime health.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" setup
```

Then:
- If the output shows Codex is **not installed** and npm is available, use `AskUserQuestion` exactly once to offer installing it. Put the install option first, suffixed `(Recommended)`:
  - `Install Codex (Recommended)`
  - `Skip for now`
  - If the user chooses install, run `npm install -g @openai/codex`, then rerun the setup command above.
- If the output shows Codex is installed but **not authenticated**, tell the user to run `!codex login` (and, if browser login is blocked, `!codex login --device-auth` or `!codex login --with-api-key`).
- If Codex is installed and authenticated, confirm they're ready to use `/codex:review`, `/codex:handoff`, and `/codex:research`.

Present the `codex doctor` output to the user; do not improvise alternate auth flows.
