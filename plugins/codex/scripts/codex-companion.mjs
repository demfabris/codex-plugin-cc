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

// Appended to every review prompt. Review is a second opinion on a plan, idea,
// or proposal — not a diff walk. The failure mode of an LLM reviewer is polite
// agreement: it restates the proposal back with adjectives and calls it sound.
// So demand a verdict, a severity-ordered list of concrete breakages, and a
// stated condition that would change its mind.
const REVIEW_CONTRACT = [
  "",
  "[review contract]",
  "- Open with a verdict: SOUND, SOUND WITH CHANGES, or DON'T DO THIS. Then justify it. Do not restate the proposal back.",
  "- Ground it in this repo. If the proposal names a file, symbol, table, dependency, or command, check it exists at HEAD and say so when it does not.",
  "- Separate what you verified from what you assumed. Label every unverified claim as an assumption.",
  "- Order problems by severity, and give each a concrete failure: the input, state, or sequence that makes it break. Cut anything you cannot make concrete.",
  "- Name the simplest alternative that reaches the same outcome, including doing nothing, and say why the proposal beats it or does not.",
  "- End with what would change your mind. Agreement with no stated reason is not a review."
].join("\n");

// Appended to every research prompt. Research is the deep web pass: what
// approaches exist, what they cost, which one fits. Left unconstrained the model
// answers from memory and calls it research, so make the web pass and the
// tradeoff comparison explicit, and force it to date what it found.
const RESEARCH_CONTRACT = [
  "",
  "[research contract]",
  "- Actually search the web. Prefer primary sources — docs, specs, changelogs, issue threads, benchmarks — over blog summaries, and cite each claim with a URL.",
  "- Surface at least three genuinely distinct approaches, including the boring one and doing nothing. If fewer than three exist, say why.",
  "- Compare them in a table on the axes that decide this call: complexity, failure modes, operational burden, cost, and how reversible each is.",
  "- Date your evidence. Libraries and APIs move; give the version or date you checked and flag anything you could not confirm is current.",
  "- Separate observed facts from inference, and list the open questions you could not close.",
  "- End with one recommendation and the condition that would flip it."
].join("\n");

const SUBCOMMANDS = new Set(["review", "handoff", "research", "setup"]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/codex-companion.mjs review    [-m <model>] [--effort <e>] [--no-web-search] <plan|idea|proposal>",
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

// Review and research are the same shape — a read-only prompt run that can still
// shell out to inspect the repo (`git diff`, `rg`) but cannot write. Only the
// contract riding on the prompt differs.
function readOnlyArgs(options, prompt) {
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

// The contract trails the prompt: it governs how Codex reports, which is the
// last thing it does, and it must not push the actual request out of the lead.
function withContract(prompt, contract) {
  return `${prompt}\n${contract}`;
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

    case "review": {
      // A second opinion on a plan or proposal, not a diff walk — so this is a
      // plain read-only prompt run, not `codex exec review` (which is pinned to
      // git targets). Web search stays on so it can check docs and prior art.
      if (!prompt) {
        throw new Error("Provide a plan, idea, or proposal for Codex to weigh in on.");
      }
      return readOnlyArgs(options, withContract(prompt, REVIEW_CONTRACT));
    }

    case "research": {
      if (!prompt) {
        throw new Error("Provide a question for Codex to research.");
      }
      return readOnlyArgs(options, withContract(prompt, RESEARCH_CONTRACT));
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
          withContract(prompt || DEFAULT_CONTINUE_PROMPT, HANDOFF_CONTRACT)
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
        withContract(prompt, HANDOFF_CONTRACT)
      ];
    }

    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

function parseSubcommand(argv) {
  return parseArgs(normalizeArgv(argv), {
    valueOptions: ["model", "effort"],
    // `wait`/`background` are Claude Code execution hints. We accept and ignore
    // them so they can't leak into the Codex prompt as positional text; the
    // slash command decides foreground vs run_in_background, not this script.
    booleanOptions: ["full-access", "network", "resume", "no-web-search", "wait", "background"],
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
