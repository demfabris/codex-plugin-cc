import test from "node:test";
import assert from "node:assert/strict";

import { buildCodexArgs, resolveCodexArgs } from "../plugins/codex/scripts/codex-companion.mjs";

const WEB_SEARCH = ["-c", "tools.web_search=true"];

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
  assert.deepEqual(resolveCodexArgs("handoff", ["implement retries"]), [
    "exec",
    ...WEB_SEARCH,
    "-s",
    "workspace-write",
    "--skip-git-repo-check",
    "implement retries"
  ]);
});

test("handoff --full-access upgrades the sandbox", () => {
  assert.deepEqual(resolveCodexArgs("handoff", ["--full-access", "do it"]), [
    "exec",
    ...WEB_SEARCH,
    "-s",
    "danger-full-access",
    "--skip-git-repo-check",
    "do it"
  ]);
});

test("handoff --resume continues the last session without re-passing sandbox", () => {
  assert.deepEqual(resolveCodexArgs("handoff", ["--resume", "apply the top fix"]), [
    "exec",
    "resume",
    "--last",
    ...WEB_SEARCH,
    "apply the top fix"
  ]);
});

test("handoff --resume with no text falls back to a continue prompt", () => {
  const args = resolveCodexArgs("handoff", ["--resume"]);
  assert.deepEqual(args.slice(0, 5), ["exec", "resume", "--last", ...WEB_SEARCH]);
  assert.match(args.at(-1), /Continue from the current thread state/);
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
  assert.equal(args.at(-1), "ship it");
});

test("wait/background execution hints are swallowed, not sent to Codex", () => {
  const withHints = resolveCodexArgs("handoff", ["--background", "refactor the parser"]);
  const withoutHints = resolveCodexArgs("handoff", ["refactor the parser"]);
  assert.deepEqual(withHints, withoutHints);
  assert.ok(!withHints.includes("--background"));
});

test("a single $ARGUMENTS string is re-tokenized into flags and prompt", () => {
  // Slash commands pass the whole argument line as one argv entry.
  assert.deepEqual(resolveCodexArgs("handoff", ["--wait fix the login bug"]), [
    "exec",
    ...WEB_SEARCH,
    "-s",
    "workspace-write",
    "--skip-git-repo-check",
    "fix the login bug"
  ]);
});

test("unknown subcommand throws", () => {
  assert.throws(() => buildCodexArgs("bogus", {}, []), /Unknown subcommand/);
});
