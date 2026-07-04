# Changelog

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
