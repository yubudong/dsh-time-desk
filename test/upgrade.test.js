import test from "node:test";
import assert from "node:assert/strict";
import { blankState, State } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { createUpgradeService, MAX_SNAPSHOTS } from "../src/upgrade.js";

function store() {
  let global = null;
  return {
    async loadAll() {
      return { global: structuredClone(global), tables: {} };
    },
    async setGlobal(v) {
      global = structuredClone(v);
    },
    async close() {},
    get value() {
      return global;
    },
  };
}
function fixture() {
  let state = blankState("upgrade-test");
  state = applyAction(
    state,
    {
      revision: 0,
      action: "save",
      collection: "tasks",
      item: { title: "Fixture task" },
    },
    1000,
  );
  state = applyAction(
    state,
    {
      revision: state.revision,
      action: "save",
      collection: "habits",
      item: {
        title: "Fixture habit",
        rules: [
          {
            effective: "2026-11-01",
            mode: "daily",
            days: [0, 1, 2, 3, 4, 5, 6],
            target: 1,
          },
        ],
      },
    },
    1000,
  );
  const service = {
    read: () => structuredClone(state),
    restore: (a) => {
      if (a.revision !== state.revision) throw Error("数据已更新，请刷新后重新操作");
      const next = State.parse(a.backup.state);
      next.revision = state.revision + 1;
      next.timer = null;
      state = next;
      return structuredClone(state);
    },
  };
  return {
    get state() {
      return state;
    },
    set state(next) {
      state = next;
    },
    service,
  };
}
function make(f, clock = 1000) {
  return createUpgradeService({
    unit: store(),
    readState: f.service.read,
    restoreState: f.service.restore,
    clock: () => clock,
  });
}

test("preflight reports an active timer and blocks snapshot creation", async () => {
  const f = fixture();
  f.state = applyAction(
    f.state,
    { revision: f.state.revision, action: "timer", command: "start" },
    1000,
  );
  const svc = make(f);
  await svc.init();
  const pre = await svc.operate({ command: "preflight" });
  assert.equal(pre.ok, false);
  assert.deepEqual(pre.blockers, [
    { code: "timer", phase: "focus", status: "running" },
  ]);
  await assert.rejects(
    svc.operate({
      command: "prepare",
      fromVersion: "0.5.3",
      targetVersion: "0.6.0",
    }),
    /结束当前计时/,
  );
});

test("prepare stores a bounded snapshot with counts and pending target", async () => {
  const f = fixture();
  const svc = make(f);
  await svc.init();
  const prepared = await svc.operate({
    command: "prepare",
    fromVersion: "0.5.3",
    targetVersion: "0.6.0",
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.snapshots.length, 1);
  assert.equal(prepared.snapshots[0].fromVersion, "0.5.3");
  assert.equal(prepared.snapshots[0].targetVersion, "0.6.0");
  assert.deepEqual(prepared.snapshots[0].counts, {
    projects: 0,
    tasks: 1,
    habits: 1,
    focusLogs: 0,
  });
  assert.equal(prepared.pending.targetVersion, "0.6.0");
  assert.ok(prepared.snapshots[0].bytes > 0);
});

test("target must be newer and valid", async () => {
  const f = fixture();
  const svc = make(f);
  await svc.init();
  await assert.rejects(
    svc.operate({
      command: "prepare",
      fromVersion: "0.5.3",
      targetVersion: "0.5.2",
    }),
    /高于/,
  );
  await assert.rejects(
    svc.operate({
      command: "prepare",
      fromVersion: "0.5.3",
      targetVersion: "main",
    }),
    /无效/,
  );
});

test("snapshots are capped at three, newest last", async () => {
  const f = fixture();
  const svc = createUpgradeService({
    unit: store(),
    readState: f.service.read,
    restoreState: f.service.restore,
    clock: (() => {
      let n = 1;
      return () => n++;
    })(),
  });
  await svc.init();
  for (let i = 0; i < MAX_SNAPSHOTS + 1; i++)
    await svc.operate({
      command: "prepare",
      fromVersion: "0.5." + (2 + i),
      targetVersion: "0.6." + i,
    });
  const view = await svc.operate({ command: "snapshots" });
  assert.equal(view.snapshots.length, MAX_SNAPSHOTS);
  assert.equal(view.snapshots.at(-1).targetVersion, "0.6.3");
});
test("restore validates confirmation and revision, and clears pending", async () => {
  const f = fixture();
  const svc = make(f);
  await svc.init();
  const prepared = await svc.operate({
    command: "prepare",
    fromVersion: "0.5.3",
    targetVersion: "0.6.0",
  });
  const id = prepared.snapshots[0].id;
  await assert.rejects(svc.operate({ command: "restoreSnapshot", id }), /确认/);
  const before = f.state;
  f.state = applyAction(
    before,
    {
      revision: before.revision,
      action: "save",
      collection: "tasks",
      item: { title: "After snapshot" },
    },
    3000,
  );
  await assert.rejects(
    svc.operate({
      command: "restoreSnapshot",
      id,
      confirm: true,
      revision: before.revision,
    }),
    /数据已更新/,
  );
  const revisionBeforeRestore = f.state.revision;
  const restored = await svc.operate({
    command: "restoreSnapshot",
    id,
    confirm: true,
    revision: revisionBeforeRestore,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.pending, null);
  assert.equal(f.state.tasks.length, 1);
  assert.equal(f.state.tasks[0].title, "Fixture task");
  assert.ok(f.state.revision > revisionBeforeRestore);
});
test("restored workspace passes schema validation with the stored format", async () => {
  const f = fixture();
  const svc = make(f);
  await svc.init();
  await svc.operate({
    command: "prepare",
    fromVersion: "0.5.3",
    targetVersion: "0.6.0",
  });
  const stored = await svc.operate({ command: "snapshots" });
  assert.ok(stored.snapshots.length === 1);
  assert.doesNotThrow(() => State.parse(f.service.read()));
});
test("oversized state is refused before a snapshot is written", async () => {
  const f = fixture();
  f.service.read = () => ({
    ...blankState("big"),
    padding: "x".repeat(2 * 1024 * 1024 + 1),
  });
  const svc = createUpgradeService({
    unit: store(),
    readState: f.service.read,
    restoreState: () => {},
  });
  await svc.init();
  await assert.rejects(
    svc.operate({
      command: "prepare",
      fromVersion: "0.5.3",
      targetVersion: "0.6.0",
    }),
    /过大/,
  );
});
