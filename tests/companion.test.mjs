import test from "node:test";
import assert from "node:assert/strict";

import { buildCodexArgs, resolveCodexArgs } from "../plugins/codex/scripts/codex-companion.mjs";

const WEB_SEARCH = ["-c", "tools.web_search=true"];
const NETWORK = ["-c", "sandbox_workspace_write.network_access=true"];
const HANDOFF_MARKER = "[verification contract]";
const REVIEW_MARKER = "[review contract]";
const RESEARCH_MARKER = "[research contract]";

// Every prompt carries a contract; assert on the request text and the marker
// separately so contract wording stays free to evolve.
function taskPrompt(args) {
  return args.at(-1);
}

test("setup maps to codex doctor", () => {
  assert.deepEqual(resolveCodexArgs("setup", []), ["doctor"]);
});

// Review is an opinion on a proposal, not a diff walk, so it is a plain
// read-only prompt run — never `codex exec review` with a git target.
test("review runs read-only with web search and no git target", () => {
  const args = resolveCodexArgs("review", ["should we shard by tenant id"]);
  assert.deepEqual(args.slice(0, -1), ["exec", ...WEB_SEARCH, "-s", "read-only", "--skip-git-repo-check"]);
  assert.match(taskPrompt(args), /^should we shard by tenant id\n/);
});

test("review does not invoke the codex review subcommand or its git targets", () => {
  const args = resolveCodexArgs("review", ["--base", "main", "is this plan sane"]);
  assert.ok(!args.includes("review"));
  assert.ok(!args.includes("--uncommitted"));
  assert.ok(!args.includes("--base"));
});

test("review requires a proposal", () => {
  assert.throws(() => resolveCodexArgs("review", []), /Provide a plan, idea, or proposal/);
});

test("--no-web-search disables the web search override", () => {
  assert.deepEqual(resolveCodexArgs("review", ["--no-web-search", "thoughts?"]).slice(0, -1), [
    "exec",
    "-s",
    "read-only",
    "--skip-git-repo-check"
  ]);
});

test("research runs read-only with web search and skips the git repo check", () => {
  const args = resolveCodexArgs("research", ["why is startup slow"]);
  assert.deepEqual(args.slice(0, -1), ["exec", ...WEB_SEARCH, "-s", "read-only", "--skip-git-repo-check"]);
  assert.match(taskPrompt(args), /^why is startup slow\n/);
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
    assert.ok(taskPrompt(resolveCodexArgs("handoff", argv)).includes(HANDOFF_MARKER));
  }
});

// Each subcommand gets exactly its own contract — a review that inherited the
// handoff's gate table, or research told to stay in scope, would report the
// wrong shape entirely.
test("each subcommand carries only its own contract", () => {
  const prompts = {
    handoff: taskPrompt(resolveCodexArgs("handoff", ["ship it"])),
    review: taskPrompt(resolveCodexArgs("review", ["is this plan sane"])),
    research: taskPrompt(resolveCodexArgs("research", ["how do others do this"]))
  };
  const markers = { handoff: HANDOFF_MARKER, review: REVIEW_MARKER, research: RESEARCH_MARKER };

  for (const [subcommand, prompt] of Object.entries(prompts)) {
    for (const [owner, marker] of Object.entries(markers)) {
      assert.equal(prompt.includes(marker), subcommand === owner, `${subcommand} vs ${marker}`);
    }
  }
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
  const args = resolveCodexArgs("research", ["-m", "SPARK", "look into it"]);
  assert.deepEqual(args.slice(0, -1), [
    "exec",
    "-m",
    "gpt-5.3-codex-spark",
    ...WEB_SEARCH,
    "-s",
    "read-only",
    "--skip-git-repo-check"
  ]);
  assert.match(taskPrompt(args), /^look into it\n/);
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
