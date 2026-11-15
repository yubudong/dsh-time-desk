import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../dist/index.js";

test("compiled distribution exposes one operation to both UI route and agent tool", async () => {
  let global = null;
  const tables = { backups: {} };
  let route, tool;
  const disposers = [];
  const unit = {
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
                assert.equal(descriptor.name, "life_desk_v1");
                return unit;
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
  for (const fn of disposers.reverse()) if (fn) await fn();
});
