import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { occurrences } from "../src/dates.js";
const now = Date.parse("2026-11-15T02:00:00Z");
function run() {
  let s = blankState("test");
  return {
    get state() {
      return s;
    },
    act(a) {
      s = applyAction(s, { revision: s.revision, ...a }, now);
      return s;
    },
  };
}
test("editing a one-off task after completion does not duplicate its calendar entry", () => {
  const h = run();
  h.act({
    action: "save",
    collection: "tasks",
    item: { title: "One", date: "2026-11-15" },
  });
  const id = h.state.tasks[0].id;
  h.act({
    action: "occurrence",
    id,
    originalDate: "2026-11-15",
    status: "done",
  });
  h.act({
    action: "save",
    collection: "tasks",
    id,
    item: { title: "Edited", date: "2026-11-16" },
  });
  const list = occurrences(h.state, "2026-11-01", "2026-11-30");
  assert.equal(list.length, 1);
  assert.equal(list[0].date, "2026-11-16");
  assert.equal(list[0].status, "done");
});
test("project deletion retains editable tasks and project restore preserves association", () => {
  const h = run();
  h.act({ action: "save", collection: "projects", item: { title: "Project" } });
  const projectId = h.state.projects[0].id;
  h.act({
    action: "save",
    collection: "tasks",
    item: { title: "Task", projectId },
  });
  const id = h.state.tasks[0].id;
  h.act({ action: "trash", collection: "projects", id: projectId });
  h.act({
    action: "save",
    collection: "tasks",
    id,
    item: { title: "Task edited" },
  });
  h.act({ action: "restore", collection: "projects", id: projectId });
  assert.equal(h.state.tasks[0].projectId, projectId);
});
test("stale editor record version is rejected even with latest global revision", () => {
  const h = run();
  h.act({ action: "save", collection: "tasks", item: { title: "Task" } });
  const old = h.state.tasks[0];
  h.act({
    action: "save",
    collection: "tasks",
    id: old.id,
    item: { note: "New note" },
  });
  assert.throws(
    () =>
      h.act({
        action: "save",
        collection: "tasks",
        id: old.id,
        version: old.version,
        item: { title: "Stale" },
      }),
    /已被修改/,
  );
});
test("lunar interval is not silently ignored", () => {
  const h = run();
  assert.throws(
    () =>
      h.act({
        action: "save",
        collection: "tasks",
        item: {
          title: "Lunar",
          date: "2026-01-01",
          repeat: { kind: "lunar", interval: 2 },
        },
      }),
    /农历首版/,
  );
});
