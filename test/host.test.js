import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../dist/index.js";

test("compiled distribution exposes one operation to both UI route and agent tool", async () => {
  let global = null;
  let updateGlobal = null;
  const tables = { backups: {} };
  const kick = {
    async loadAll() {
      return structuredClone({ global, tables });
    },
    async setGlobal(v) {
      global = structuredClone(v);
    },
    async putRecord(t, k, v) {
      tables[t][k] = structuredClone(v);
    },
    async close() {},
  };
  let upgradeGlobal = null;
  const upgradeKick = {
    async loadAll() {
      return { global: structuredClone(upgradeGlobal), tables: {} };
    },
    async setGlobal(v) {
      upgradeGlobal = structuredClone(v);
    },
    async close() {},
  };
  const updateKick = {
    async loadAll() {
      return { global: structuredClone(updateGlobal), tables: {} };
    },
    async setGlobal(v) {
      updateGlobal = structuredClone(v);
    },
    async close() {},
  };
  let route, tool;
  const disposers = [];
  const ctx = {
    storage: {
      backend: {
        get(name) {
          assert.equal(name, "json");
          return {
            kv: {
              async open(descriptor) {
                assert.match(descriptor.name, /^[a-z][a-z0-9_]*$/);
                for (const table of descriptor.tables)
                  assert.match(table, /^[a-z][a-z0-9_]*$/);
                assert.ok(
                  [
                    "life_desk_v1",
                    "life_desk_update",
                    "life_desk_upgrade",
                  ].includes(descriptor.name),
                );
                return descriptor.name === "life_desk_v1"
                  ? kick
                  : descriptor.name === "life_desk_update"
                    ? updateKick
                    : upgradeKick;
              },
            },
          };
        },
      },
    },
    connection: {
      fetch: {
        register(r) {
          route = r;
          return async () => {};
        },
      },
    },
    tools: {
      register(t) {
        tool = t;
        return () => {};
      },
    },
    effect(fn) {
      disposers.push(fn());
    },
    provide(name, value) {
      assert.equal(name, "lifeDesk");
      assert.equal(typeof value.operate, "function");
    },
  };
  await apply(ctx);
  assert.equal(route.path, "/api/life-desk");
  assert.equal(tool.name, "life_desk");
  const initial = await tool.execute({ action: "read" });
  assert.equal(initial.revision, 0);
  assert.equal(initial.tasks.total, 0);
  const help = await tool.execute({ action: "help" });
  assert.ok(help.schemas.tasks.properties.repeat);
  assert.match(help.guide.rules, /农历/);
  const update = await tool.execute({ action: "update", command: "status" });
  assert.match(update.currentVersion, /^\d+\.\d+\.\d+/);
  assert.equal(update.state.kind, "none");
  assert.deepEqual(update.prefs, { autoCheck: false, ignoredVersion: "" });
  assert.equal(typeof update.releasePage, "string");
  await assert.rejects(
    tool.execute({ action: "update", command: "settings", autoCheck: true }),
    /仅可查看/,
  );
  const preflight = await (
    await route.fetch(
      new Request("http://local/api/life-desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upgrade", command: "preflight" }),
      }),
    )
  ).json();
  assert.equal(preflight.value.ok, true);
  assert.equal(preflight.value.timer, null);
  const written = await tool.execute({
    action: "save",
    revision: 0,
    requestId: "host-parity",
    collection: "tasks",
    item: { title: "Tool-created task", area: "work", date: "2026-11-15" },
  });
  assert.equal(written.ok, true);
  const ui = await route.fetch(
    new Request("http://local/api/life-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    }),
  );
  const value = await ui.json();
  assert.equal(value.value.tasks[0].title, "Tool-created task");
  assert.equal(value.value.revision, 1);
  const patch = await route.fetch(
    new Request("http://local/api/life-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        revision: 1,
        collection: "tasks",
        id: value.value.tasks[0].id,
        item: { title: "UI-edited task" },
      }),
    }),
  );
  assert.equal(patch.status, 200);
  const after = await tool.execute({ action: "read" });
  assert.equal(after.tasks.items[0].title, "UI-edited task");
  const failure = await route.fetch(
    new Request("http://local/api/life-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        revision: 0,
        collection: "tasks",
        item: { title: "Stale" },
      }),
    }),
  );
  assert.equal(failure.status, 400);
  assert.equal((await failure.json()).ok, false);
  await assert.rejects(
    tool.execute({
      action: "save",
      revision: 0,
      collection: "tasks",
      item: { title: "Stale" },
    }),
    /更新/,
  );
  for (const name of ["lesson", "lessonTerm", "lessonSession", "lessonCharge"])
    assert.ok(
      tool.parameters.properties.action.enum.includes(name),
      name + " must be admitted by the Agent tool schema",
    );
  const strictJson = (value) =>
    assert.deepEqual(
      JSON.parse(JSON.stringify(value)),
      value,
      "Tool receipt must be lossless JSON",
    );
  const savedSettings = await tool.execute({
    action: "settings",
    revision: after.revision,
    item: { focusMinutes: 35 },
  });
  strictJson(savedSettings);
  assert.equal(savedSettings.lastRecord, null);
  const course = await tool.execute({
    action: "lesson",
    revision: savedSettings.revision,
    opening: 2,
    item: {
      title: "Synthetic tool course",
      mode: "credit",
      effective: "2020-01-01",
      weekdays: [1],
      time: "10:00",
    },
  });
  strictJson(course);
  assert.equal(course.lastRecord.title, "Synthetic tool course");
  const attended = await tool.execute({
    action: "lessonSession",
    revision: course.revision,
    id: course.lastRecord.id,
    originalDate: "2020-01-06",
    command: "complete",
    deduction: 1,
  });
  strictJson(attended);
  assert.equal(attended.lastRecord.status, "done");
  const refunded = await tool.execute({
    action: "lessonSession",
    revision: attended.revision,
    id: course.lastRecord.id,
    sessionId: attended.lastRecord.id,
    command: "undo",
  });
  strictJson(refunded);
  assert.equal(refunded.lastRecord.status, "scheduled");
  assert.equal(tool.parameters.properties.confirmRest.type, "boolean");
  const weekly = await tool.execute({
    action: "save",
    revision: refunded.revision,
    collection: "habits",
    item: {
      title: "Synthetic weekly tool",
      rules: [
        { effective: "2020-01-01", mode: "weekly", target: 3, restDays: 1 },
      ],
    },
  });
  strictJson(weekly);
  const forecast = await tool.execute({
    action: "plan",
    command: "habits",
    date: "2020-01-06",
  });
  strictJson(forecast);
  assert.equal(forecast.revision, weekly.revision);
  assert.equal(forecast.weekly[0].restDays, 1);
  for (const fn of disposers.reverse()) if (fn) await fn();
});
