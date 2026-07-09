#!/usr/bin/env node

// Thin translator from plugin subcommands to `codex exec`.
//
// The plugin used to speak the Codex app-server JSON-RPC protocol through a
// broker and track its own background jobs. All of that is gone: the modern
// `codex exec` CLI streams progress to stdout, resumes sessions, and reviews
// git state natively, so this script just builds the right `codex` argv and
// hands stdio straight through. Backgrounding is Claude Code's job now
// (`run_in_background` + BashOutput), not ours.

import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";

const MODEL_ALIASES = new Map([["spark", "gpt-5.3-codex-spark"]]);
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";

// Appended to every handoff prompt. Each rule exists because Codex broke it in a
// real run and a clean "all gates green" report hid the damage: a ClickHouse
// syntax error behind an env-gated test that self-skipped in 0.00s; a `cargo
// check` that passed against a vendored submodule the build doesn't consume; a
// fix compiled only with its test feature on, breaking the production build; and
// two retired SQL views faithfully recreated from a spec that had gone stale.
// Codex cannot be trusted to self-certify, so make it show its work instead.
const HANDOFF_CONTRACT = [
  "",
  "[verification contract]",
  "- A gate you did not run is not a gate. For every build, lint, or test you claim passed, give the exact command and its exit code. If you did not run it, write \"not run\".",
  "- A test that did not execute is not a pass. Report env-gated, filtered, or skipped tests as SKIPPED even when the suite is green. A near-zero runtime means it never ran.",
  "- Name what you compiled: the exact package/target and the feature flags. If the code has feature-gated paths, also build the configuration that ships to production, not only the one your change compiles under.",
  "- If the task references a file, symbol, table, or migration that does not exist at HEAD, stop and report the discrepancy. Do not recreate it to satisfy the instructions.",
  "- Report every deviation from the task. Do not widen scope, and do not edit files the task did not name."
].join("\n");

const SUBCOMMANDS = new Set(["review", "handoff", "research", "setup"]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/codex-companion.mjs review    [--base <ref>|--commit <sha>] [-m <model>] [--effort <e>] [--no-web-search] [focus text]",
      "  node scripts/codex-companion.mjs handoff   [--full-access] [--network] [--resume] [-m <model>] [--effort <e>] [--no-web-search] <task>",
      "  node scripts/codex-companion.mjs research  [-m <model>] [--effort <e>] [--no-web-search] <question>",
      "  node scripts/codex-companion.mjs setup"
    ].join("\n")
  );
}

// A single `"$ARGUMENTS"` string from a slash command arrives as one argv
// entry; split it back into tokens. Already-tokenized argv passes through.
function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    return raw && raw.trim() ? splitRawArgumentString(raw) : [];
  }
  return argv;
}

function normalizeModel(model) {
  if (model == null) {
    return null;
  }
  const value = String(model).trim();
  if (!value) {
    return null;
  }
  return MODEL_ALIASES.get(value.toLowerCase()) ?? value;
}

function modelArgs(options) {
  const model = normalizeModel(options.model);
  return model ? ["-m", model] : [];
}

// Reasoning effort and web search both ride in as `-c key=value` config
// overrides. Web search is on by default (the whole point of review/research)
// and can be turned off with --no-web-search.
function configArgs(options) {
  const args = [];
  if (options.effort != null && String(options.effort).trim()) {
    args.push("-c", `model_reasoning_effort=${String(options.effort).trim()}`);
  }
  if (!options["no-web-search"]) {
    args.push("-c", "tools.web_search=true");
  }
  return args;
}

function sandboxMode(options) {
  return options["full-access"] ? "danger-full-access" : "workspace-write";
}

// `workspace-write` sandboxes the filesystem *and* cuts the network, which
// silently dooms any task that has to reach a cloud API or a database. Rather
// than force `--full-access` (which drops the filesystem sandbox too), let
// `--network` punch a hole for just the network. `danger-full-access` already
// has one, so the override is redundant there.
function networkArgs(options, mode) {
  if (!options.network || mode !== "workspace-write") {
    return [];
  }
  return ["-c", "sandbox_workspace_write.network_access=true"];
}

// `codex exec resume` takes no `-s`. Left alone it falls back to the sandbox in
// the user's config.toml — neither the resumed session's sandbox nor the
// workspace-write default a fresh handoff would get. So `--resume` silently
// escalates to `danger-full-access` for anyone whose config says so, and
// silently drops every edit for anyone whose config says `read-only`. Sandbox is
// reachable as a config key, so pin it to the mode this handoff actually asked
// for.
function resumeSandboxArgs(mode) {
  return ["-c", `sandbox_mode=${mode}`];
}

function reviewTargetArgs(options) {
  if (options.base) {
    return ["--base", String(options.base)];
  }
  if (options.commit) {
    return ["--commit", String(options.commit)];
  }
  return ["--uncommitted"];
}

// The contract trails the task: it governs how Codex reports, which is the last
// thing it does, and it must not push the actual request out of the lead.
function withContract(prompt) {
  return `${prompt}\n${HANDOFF_CONTRACT}`;
}

/**
 * Translate a plugin subcommand into a full `codex` argv.
 * Pure and exported so tests can assert the mapping without invoking Codex.
 * @returns {string[]}
 */
export function buildCodexArgs(subcommand, options = {}, positionals = []) {
  const prompt = positionals.join(" ").trim();

  switch (subcommand) {
    case "setup":
      // `codex doctor` diagnoses install, auth, config, and runtime health.
      return ["doctor"];

    case "review":
      // Read-only by nature; web search on so the reviewer can check docs/CVEs.
      return [
        "exec",
        "review",
        ...modelArgs(options),
        ...configArgs(options),
        ...reviewTargetArgs(options),
        ...(prompt ? [prompt] : [])
      ];

    case "research": {
      if (!prompt) {
        throw new Error("Provide a question for Codex to research.");
      }
      return [
        "exec",
        ...modelArgs(options),
        ...configArgs(options),
        "-s",
        "read-only",
        "--skip-git-repo-check",
        prompt
      ];
    }

    case "handoff": {
      const sandbox = sandboxMode(options);
      if (options.resume) {
        // Continue the most recent Codex session in this repo, re-asserting the
        // sandbox rather than inheriting whatever the last run happened to use.
        return [
          "exec",
          "resume",
          "--last",
          ...modelArgs(options),
          ...configArgs(options),
          ...networkArgs(options, sandbox),
          ...resumeSandboxArgs(sandbox),
          withContract(prompt || DEFAULT_CONTINUE_PROMPT)
        ];
      }
      if (!prompt) {
        throw new Error("Provide a task for Codex to implement, or pass --resume to continue the last handoff.");
      }
      return [
        "exec",
        ...modelArgs(options),
        ...configArgs(options),
        ...networkArgs(options, sandbox),
        "-s",
        sandbox,
        "--skip-git-repo-check",
        withContract(prompt)
      ];
    }

    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

function parseSubcommand(argv) {
  return parseArgs(normalizeArgv(argv), {
    valueOptions: ["model", "effort", "base", "commit"],
    // `wait`/`background` are Claude Code execution hints. We accept and ignore
    // them so they can't leak into the Codex prompt as positional text; the
    // slash command decides foreground vs run_in_background, not this script.
    booleanOptions: ["full-access", "network", "resume", "no-web-search", "uncommitted", "wait", "background"],
    aliasMap: { m: "model" }
  });
}

/**
 * Parse a subcommand's raw args and translate them into a `codex` argv.
 * Exported so tests can exercise the full parse+build path without spawning.
 * @returns {string[]}
 */
export function resolveCodexArgs(subcommand, argv) {
  const { options, positionals } = parseSubcommand(argv);
  return buildCodexArgs(subcommand, options, positionals);
}

function runCodex(args) {
  const child = spawn("codex", args, {
    // Ignore stdin (the prompt comes from argv); stream stdout/stderr straight
    // through so progress is live in the foreground and in background shells.
    stdio: ["ignore", "inherit", "inherit"],
    // Windows resolves the `codex.cmd` shim only through a shell.
    shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
    windowsHide: true
  });

  child.on("error", (error) => {
    if (error && error.code === "ENOENT") {
      process.stderr.write("Codex CLI not found on PATH. Install it with `npm install -g @openai/codex`, then rerun /codex:setup.\n");
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

function main() {
  const [subcommand, ...argv] = process.argv.slice(2);

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  if (!SUBCOMMANDS.has(subcommand)) {
    process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  runCodex(resolveCodexArgs(subcommand, argv));
}

// Only drive Codex when run as a script; importing (e.g. tests) must not spawn.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
