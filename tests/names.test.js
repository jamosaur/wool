import { test } from "node:test";
import assert from "node:assert/strict";
import { branchSlug, shortHash } from "../mods/wool/lib/names.js";

test("a branch that is already a slug is kept", () => {
  assert.equal(branchSlug("main"), "main");
  assert.equal(branchSlug("fix-123"), "fix-123");
});

test("other branches are cleaned up and get a hash of the real name", () => {
  assert.match(branchSlug("feat/Login Page"), /^feat-login-page-[0-9a-f]{6}$/);
  assert.match(branchSlug("--x__y--"), /^x-y-[0-9a-f]{6}$/);
  assert.match(branchSlug("日本"), /^[0-9a-f]{6}$/);
});

test("branches that clean up the same still get different slugs", () => {
  assert.notEqual(branchSlug("feat/a"), branchSlug("feat-a"));
  assert.notEqual(branchSlug("feat/a"), branchSlug("Feat/A"));
});

test("long branches are cut to 40 characters plus the hash", () => {
  const s = branchSlug("a".repeat(60));
  assert.equal(s, `${"a".repeat(40)}-${shortHash("a".repeat(60))}`);
  assert.match(branchSlug(`${"a".repeat(39)}/b`), new RegExp(`^${"a".repeat(39)}-[0-9a-f]{6}$`));
});

test("slugs are stable", () => {
  assert.equal(branchSlug("feat/x"), branchSlug("feat/x"));
  assert.equal(shortHash("feat/x"), shortHash("feat/x"));
});

test("a detached worktree has no slug", () => {
  assert.equal(branchSlug(""), "");
  assert.equal(branchSlug(null), "");
});
