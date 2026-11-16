import test from "node:test";
import assert from "node:assert/strict";
import { createUpgradeService } from "../src/upgrade.js";
import { blankState } from "../src/schema.js";
function memory() {
  let value = null;
  return {
    fail: false,
    async loadAll() {
      return { global: structuredClone(value) };
    },
    async setGlobal(v) {
      if (this.fail) throw Error("disk unavailable");
      value = structuredClone(v);
    },
    async close() {},
  };
}
test("failed snapshot persist does not leak pending state, and successful state survives reopen", async () => {
  const unit = memory(),
    state = blankState("synthetic");
  const options = {
    unit,
    readState: async () => state,
    restoreState: async () => {},
    currentVersion: "0.6.0",
  };
  const svc = createUpgradeService(options);
  await svc.init();
  unit.fail = true;
  await assert.rejects(
    svc.operate({ command: "prepare", targetVersion: "0.7.0" }),
    /disk/,
  );
  assert.deepEqual((await svc.operate({ command: "snapshots" })).snapshots, []);
  unit.fail = false;
  const saved = await svc.operate({
    command: "prepare",
    targetVersion: "0.7.0",
    fromVersion: "0.1.0",
  });
  assert.equal(saved.prepared.fromVersion, "0.6.0");
  const reopened = createUpgradeService({
    ...options,
    currentVersion: "0.7.0",
  });
  const view = await reopened.init();
  assert.equal(view.currentVersion, "0.7.0");
  assert.equal(view.pending.targetVersion, "0.7.0");
  assert.equal(view.snapshots.length, 1);
});
test("metadata failure after restore reports success and warns instead of inviting another overwrite", async () => {
  const unit = memory();
  let restored = false;
  const svc = createUpgradeService({
    unit,
    readState: async () => blankState("synthetic"),
    restoreState: async () => {
      restored = true;
      unit.fail = true;
    },
  });
  await svc.init();
  const saved = await svc.operate({
    command: "prepare",
    fromVersion: "0.6.0",
    targetVersion: "0.7.0",
  });
  const result = await svc.operate({
    command: "restoreSnapshot",
    id: saved.prepared.id,
    confirm: true,
    revision: 0,
  });
  assert.equal(restored, true);
  assert.equal(result.ok, true);
  assert.match(result.warning, /已恢复/);
});
test("UTF-8 byte limit rejects non-ASCII payload below the character limit", async () => {
  const state = { ...blankState("synthetic"), padding: "字".repeat(750000) };
  const svc = createUpgradeService({
    unit: memory(),
    readState: async () => state,
  });
  await svc.init();
  await assert.rejects(
    svc.operate({
      command: "prepare",
      fromVersion: "0.6.0",
      targetVersion: "0.7.0",
    }),
    /过大/,
  );
});
test("fresh revision and Host assistant busy are checked again when preparing", async () => {
  let busy = false;
  const state = blankState("synthetic");
  const svc = createUpgradeService({
    unit: memory(),
    readState: async () => state,
    isBusy: async () => busy,
  });
  await svc.init();
  const pre = await svc.operate({ command: "preflight" });
  state.revision++;
  await assert.rejects(
    svc.operate({
      command: "prepare",
      revision: pre.revision,
      targetVersion: "0.7.0",
    }),
    /更新/,
  );
  busy = true;
  assert.deepEqual((await svc.operate({ command: "preflight" })).blockers, [
    { code: "assistant" },
  ]);
  await assert.rejects(
    svc.operate({ command: "prepare", targetVersion: "0.7.0" }),
    /精灵/,
  );
});
