import test from "node:test";
import assert from "node:assert/strict";

import { buildCodexArgs, resolveCodexArgs } from "../plugins/codex/scripts/codex-companion.mjs";

const WEB_SEARCH = ["-c", "tools.web_search=true"];
const NETWORK = ["-c", "sandbox_workspace_write.network_access=true"];
const CONTRACT_MARKER = "[verification contract]";

// Handoff prompts carry the verification contract; assert on the task text and
// the marker separately so the contract's wording stays free to evolve.
function taskPrompt(args) {
  return args.at(-1);
}

test("setup maps to codex doctor", () => {
  assert.deepEqual(resolveCodexArgs("setup", []), ["doctor"]);
});

test("review defaults to uncommitted working tree with web search", () => {
  assert.deepEqual(resolveCodexArgs("review", []), ["exec", "review", ...WEB_SEARCH, "--uncommitted"]);
});

test("review honors --base", () => {
  assert.deepEqual(resolveCodexArgs("review", ["--base", "main"]), [
    "exec",
    "review",
    ...WEB_SEARCH,
    "--base",
    "main"
  ]);
});

test("review honors --commit", () => {
  assert.deepEqual(resolveCodexArgs("review", ["--commit", "abc123"]), [
    "exec",
    "review",
    ...WEB_SEARCH,
    "--commit",
    "abc123"
  ]);
});

test("review appends focus text as a trailing prompt", () => {
  assert.deepEqual(resolveCodexArgs("review", ["check the auth flow"]), [
    "exec",
    "review",
    ...WEB_SEARCH,
    "--uncommitted",
    "check the auth flow"
  ]);
});

test("--no-web-search disables the web search override", () => {
  assert.deepEqual(resolveCodexArgs("review", ["--no-web-search"]), ["exec", "review", "--uncommitted"]);
});

test("research runs read-only with web search and skips the git repo check", () => {
  assert.deepEqual(resolveCodexArgs("research", ["why is startup slow"]), [
    "exec",
    ...WEB_SEARCH,
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "why is startup slow"
  ]);
});

test("research requires a question", () => {
  assert.throws(() => resolveCodexArgs("research", []), /Provide a question/);
});

test("handoff runs workspace-write by default", () => {
  const args = resolveCodexArgs("handoff", ["implement retries"]);
  assert.deepEqual(args.slice(0, -1), ["exec", ...WEB_SEARCH, "-s", "workspace-write", "--skip-git-repo-check"]);
  assert.match(taskPrompt(args), /^implement retries\n/);
});

test("handoff --full-access upgrades the sandbox", () => {
  const args = resolveCodexArgs("handoff", ["--full-access", "do it"]);
  assert.deepEqual(args.slice(0, -1), ["exec", ...WEB_SEARCH, "-s", "danger-full-access", "--skip-git-repo-check"]);
});

test("every handoff prompt carries the verification contract", () => {
  for (const argv of [["implement retries"], ["--resume", "keep going"], ["--full-access", "do it"]]) {
    assert.ok(taskPrompt(resolveCodexArgs("handoff", argv)).includes(CONTRACT_MARKER));
  }
});

test("review and research prompts stay contract-free", () => {
  assert.ok(!taskPrompt(resolveCodexArgs("review", ["check auth"])).includes(CONTRACT_MARKER));
  assert.ok(!taskPrompt(resolveCodexArgs("research", ["why slow"])).includes(CONTRACT_MARKER));
});

// `codex exec resume` has no `-s`; unpinned it falls back to the user's
// config.toml sandbox, which silently escalates or silently drops every edit.
test("handoff --resume pins the sandbox instead of inheriting it", () => {
  const args = resolveCodexArgs("handoff", ["--resume", "apply the top fix"]);
  assert.deepEqual(args.slice(0, -1), [
    "exec",
    "resume",
    "--last",
    ...WEB_SEARCH,
    "-c",
    "sandbox_mode=workspace-write"
  ]);
  assert.match(taskPrompt(args), /^apply the top fix\n/);
});

test("handoff --resume --full-access resumes with the upgraded sandbox", () => {
  const args = resolveCodexArgs("handoff", ["--resume", "--full-access", "keep going"]);
  assert.ok(args.includes("sandbox_mode=danger-full-access"));
  assert.ok(!args.includes("sandbox_mode=workspace-write"));
});

test("handoff --resume with no text falls back to a continue prompt", () => {
  const args = resolveCodexArgs("handoff", ["--resume"]);
  assert.deepEqual(args.slice(0, 5), ["exec", "resume", "--last", ...WEB_SEARCH]);
  assert.match(taskPrompt(args), /Continue from the current thread state/);
});

// workspace-write cuts the network; --network restores it without also giving up
// the filesystem sandbox the way --full-access does.
test("handoff --network opens the network inside the workspace-write sandbox", () => {
  const args = resolveCodexArgs("handoff", ["--network", "sync the staging bucket"]);
  assert.deepEqual(args.slice(0, -1), [
    "exec",
    ...WEB_SEARCH,
    ...NETWORK,
    "-s",
    "workspace-write",
    "--skip-git-repo-check"
  ]);
});

test("handoff --network is redundant under --full-access and is dropped", () => {
  const args = resolveCodexArgs("handoff", ["--network", "--full-access", "do it"]);
  assert.ok(!args.includes("sandbox_workspace_write.network_access=true"));
  assert.ok(args.includes("danger-full-access"));
});

test("handoff --resume --network carries the network override", () => {
  const args = resolveCodexArgs("handoff", ["--resume", "--network", "keep going"]);
  assert.ok(args.includes("sandbox_workspace_write.network_access=true"));
  assert.ok(args.includes("sandbox_mode=workspace-write"));
});

test("--network does not leak into review or research", () => {
  assert.ok(!resolveCodexArgs("review", ["--network", "check auth"]).includes("sandbox_workspace_write.network_access=true"));
  assert.ok(!resolveCodexArgs("research", ["--network", "why slow"]).includes("sandbox_workspace_write.network_access=true"));
});

test("handoff without a task or --resume throws", () => {
  assert.throws(() => resolveCodexArgs("handoff", []), /Provide a task/);
});

test("spark alias resolves to the codex spark model, case-insensitively", () => {
  assert.deepEqual(resolveCodexArgs("research", ["-m", "SPARK", "look into it"]), [
    "exec",
    "-m",
    "gpt-5.3-codex-spark",
    ...WEB_SEARCH,
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "look into it"
  ]);
});

test("--effort becomes a model_reasoning_effort config override", () => {
  const args = resolveCodexArgs("handoff", ["--effort", "high", "ship it"]);
  assert.deepEqual(args.slice(0, 4), ["exec", "-c", "model_reasoning_effort=high", "-c"]);
  assert.match(taskPrompt(args), /^ship it\n/);
});

test("wait/background execution hints are swallowed, not sent to Codex", () => {
  const withHints = resolveCodexArgs("handoff", ["--background", "refactor the parser"]);
  const withoutHints = resolveCodexArgs("handoff", ["refactor the parser"]);
  assert.deepEqual(withHints, withoutHints);
  assert.ok(!withHints.includes("--background"));
});

test("a single $ARGUMENTS string is re-tokenized into flags and prompt", () => {
  // Slash commands pass the whole argument line as one argv entry.
  const args = resolveCodexArgs("handoff", ["--wait fix the login bug"]);
  assert.deepEqual(args.slice(0, -1), ["exec", ...WEB_SEARCH, "-s", "workspace-write", "--skip-git-repo-check"]);
  assert.match(taskPrompt(args), /^fix the login bug\n/);
});

test("unknown subcommand throws", () => {
  assert.throws(() => buildCodexArgs("bogus", {}, []), /Unknown subcommand/);
});
