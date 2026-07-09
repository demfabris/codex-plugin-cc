# Changelog

## 2.1.0

- `handoff --resume` now pins the sandbox instead of leaving it unset. `codex exec
  resume` takes no `-s`, so a resumed run silently fell back to whatever
  `sandbox_mode` the user's `config.toml` declared — escalating to
  `danger-full-access` for some users and dropping every edit on the floor for
  those defaulting to `read-only`. Resume is now exactly as privileged as the
  handoff that launched it, and honors `--full-access`/`--network`.
- New `handoff --network`: opens network access inside the `workspace-write`
  sandbox. Previously any task that had to reach a cloud API, database, or tunnel
  either failed silently or forced `--full-access`, which also gives up the
  filesystem sandbox.
- Every `handoff` prompt now carries a verification contract: name the command and
  exit code behind each gate claimed to pass, report env-gated or skipped tests as
  SKIPPED rather than passing, name the build target and feature flags compiled,
  halt when the task references something absent at HEAD, and disclose deviations.

## 2.0.0

- Rewrote the plugin around the `codex exec` CLI. Removed the app-server JSON-RPC
  client, the shared-runtime broker, the background job board, the stop-time
  review gate hook, and the `codex-rescue` subagent.
- Commands now stream Codex output live and run in Claude Code background shells;
  backgrounding, progress, and cancellation are handled natively by Claude Code.
- New command surface: `/codex:review` (read-only, web search),
  `/codex:handoff` (write-capable implementation), `/codex:research`
  (read-only investigation, web search), `/codex:setup` (`codex doctor`).
- Removed `/codex:adversarial-review`, `/codex:transfer`, `/codex:status`,
  `/codex:result`, and `/codex:cancel`.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
