import test from "node:test";
import assert from "node:assert/strict";
import { privacyIssues } from "../scripts/privacy.mjs";
const bytes = (s) => Buffer.from(s);
test("privacy gate rejects task databases, chat logs and credential files", () => {
  for (const file of [
    "life_desk_v1.json",
    "data/life_desk_spirit.json",
    "session.jsonl",
    "profile.sqlite",
    "secrets/.env",
    "backups/export.json",
    ".npmrc",
  ])
    assert.ok(privacyIssues(file, bytes("{}")).length, file);
});
test("privacy gate detects renamed personal snapshots", () => {
  assert.ok(
    privacyIssues(
      "innocent.json",
      bytes(
        JSON.stringify({
          schemaVersion: 1,
          deviceId: "test",
          tasks: [],
          habits: [],
        }),
      ),
    ).includes("serialized personal workspace"),
  );
});
test("privacy gate detects home paths and credentials without printing values", () => {
  const home = ["", "Users", "someone", "Documents", "private"].join("/");
  assert.ok(
    privacyIssues("source.js", bytes(home)).includes("local home path"),
  );
  const token = ["gh", "p_", "x".repeat(40)].join("");
  assert.ok(
    privacyIssues("config.json", bytes(token)).includes("GitHub credential"),
  );
});
test("public metadata and compatibility format labels remain shareable", () => {
  assert.deepEqual(
    privacyIssues(
      "package.json",
      bytes(
        JSON.stringify({
          name: "dsh-time-desk",
          repository: "https://github.com/yubudong/dsh-time-desk",
        }),
      ),
    ),
    [],
  );
  assert.deepEqual(
    privacyIssues("src/model.js", bytes('format: "dsh-life-desk"')),
    [],
  );
});
