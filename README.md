# Codex plugin for Claude Code

Use Codex from inside Claude Code to review code, hand off implementation tasks, or research — without leaving your Claude Code session.

> This is a fork that rewrites the plugin around the `codex exec` CLI. It drops the bespoke app-server broker, background job board, and stop-gate hook in favor of shelling straight into Codex and letting Claude Code own backgrounding. See [What changed in 2.0](#what-changed-in-20).

## What You Get

- `/codex:review` — read-only code review of your local git changes, with web search
- `/codex:handoff` — hand an implementation task to Codex with full write access to the repo
- `/codex:research` — ask Codex to investigate a question read-only, with web search
- `/codex:setup` — check that Codex is installed and authenticated

## Requirements

- **ChatGPT subscription (incl. Free) or OpenAI API key.** Usage contributes to your Codex limits. [Learn more](https://developers.openai.com/codex/pricing).
- **Codex CLI** installed and logged in (`codex login`).
- **Node.js 18.18 or later.**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add demfabris/codex-plugin-cc
```

Install the plugin and reload:

```bash
/plugin install codex@codex-cc
/reload-plugins
```

Then check readiness:

```bash
/codex:setup
```

`/codex:setup` runs `codex doctor`. If Codex is missing and npm is available, it can offer to install it (`npm install -g @openai/codex`). If Codex is installed but not logged in, run:

```bash
!codex login
```

## Usage

### `/codex:review`

Read-only Codex review of your current work, with web search enabled so the reviewer can check docs and advisories. It does **not** change code.

- Default target is the uncommitted working tree.
- `--base <ref>` reviews the branch against a base; `--commit <sha>` reviews a single commit.

```bash
/codex:review
/codex:review --base main
/codex:review --wait          # stream in the foreground instead of backgrounding
```

### `/codex:handoff`

Hand an implementation task to Codex with **workspace write access**. Codex edits files and runs commands in the repo to complete the task.

- `--resume` continues the most recent Codex session in this repo ("keep going", "apply the top fix"). The sandbox is pinned to this invocation's flags, so re-pass `--network`/`--full-access` if you still want them.
- `--network` keeps the filesystem sandbox but opens the network. Needed for anything that talks to a cloud API, a database, or a tunnel.
- `--full-access` upgrades to `danger-full-access` (no sandbox). Use sparingly — prefer `--network`.
- `-m <model>` / `--effort <e>` are optional; `spark` maps to `gpt-5.3-codex-spark`.

```bash
/codex:handoff implement the retry logic in the http client
/codex:handoff --resume apply the top fix from the last run
/codex:handoff --network reconcile the staging bucket against the manifest
/codex:handoff --wait fix the failing test
```

Fire several at once — each runs as its own Claude Code background shell, so you can orchestrate a fleet of Codex agents in parallel.

Every handoff prompt carries a **verification contract**: Codex must name the exact command and exit code behind each gate it claims passed, report env-gated or skipped tests as SKIPPED instead of passing, name the build target and feature flags it compiled, stop when the task references something that no longer exists at HEAD, and disclose deviations. It makes Codex's report auditable — it does not make the report true. Re-run the gates yourself before you trust them.

### `/codex:research`

Ask Codex to investigate **read-only**, with web search. Good for root-cause analysis, comparing approaches, or gathering external context. It reports findings and changes nothing.

```bash
/codex:research why does the build regress after upgrading vite
/codex:research --wait compare tokio vs async-std for this workload
```

## How backgrounding works

By default, `review` / `handoff` / `research` run in a **Claude Code background shell** (`run_in_background`). Claude streams progress with `BashOutput` and is notified when the run finishes — there is no plugin-side job board, status command, or broker to sync with. Add `--wait` to stream in the foreground for a quick, interactive run.

Cancel a run the same way you cancel any Claude Code background task (kill the shell). Resume a Codex thread later with `codex resume` in your terminal, or `/codex:handoff --resume`.

## Configuration

The plugin uses your global `codex` binary and its [configuration](https://developers.openai.com/codex/config-basic). To change the default model or reasoning effort, set them in `~/.codex/config.toml` (user-level) or `.codex/config.toml` (project-level, when the project is trusted):

```toml
model = "gpt-5.4-mini"
model_reasoning_effort = "high"
```

The plugin leaves model and effort unset unless you pass `-m` / `--effort`, so your Codex config defaults apply.

## What changed in 2.0

This fork was rebuilt to work with the grain of Claude Code:

| Removed | Replaced by |
| --- | --- |
| App-server JSON-RPC client + turn-capture state machine | `codex exec` streaming straight to stdout |
| Shared-runtime broker (single-flight unix socket) | one `codex exec` per call — parallel by default |
| Plugin job board (`/codex:status`, `/codex:result`, `/codex:cancel`) | Claude Code background shells + `BashOutput` + `codex resume` |
| Stop-time review gate hook (usage-drain / loop risk) | removed |
| `codex-rescue` subagent + command/skill naming maze | `/codex:handoff` runs one process, no subagent |
| `/codex:adversarial-review`, `/codex:transfer` | folded into `review` / `research`; dropped |

The result: live progress instead of silent hangs, no surprise Codex runs, and roughly a third of the previous runtime code.

## FAQ

**Do I need a separate Codex account?** No. The plugin uses your local Codex CLI authentication. If you're signed into Codex on this machine, it works here too.

**Does it use a separate Codex runtime?** No. It shells into your local `codex` binary, same install, same auth, same config, same checkout.

**Can I keep my API key / base URL setup?** Yes. Because it uses your local Codex CLI, your existing sign-in and config still apply.
