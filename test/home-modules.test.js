import test from "node:test";
import assert from "node:assert/strict";
import { blankState, Settings } from "../src/schema.js";
import { applyAction, createService } from "../src/model.js";
import { dailyPlan } from "../src/planning.js";
import {
  HOME_MODULES,
  HOME_MODULE_IDS,
  homeModules,
  isFolded,
} from "../src/home-modules.js";
const NOW = Date.parse("2026-11-17T02:00:00Z");
test("default home shows every module in registry order", () => {
  const s = blankState("home");
  assert.deepEqual(
    homeModules(s.settings, "main").map((x) => x.id),
    HOME_MODULES.filter((x) => x.region === "main").map((x) => x.id),
  );
  const mainIds = homeModules(s.settings, "main").map((x) => x.id);
  assert.equal(mainIds.includes("plan"), false);
  assert.ok(mainIds.indexOf("lessons") > mainIds.indexOf("planned"));
  assert.ok(mainIds.indexOf("lessons") < mainIds.indexOf("carry"));
  assert.deepEqual(
    homeModules(s.settings, "support").map((x) => x.id),
    HOME_MODULES.filter((x) => x.region === "support").map((x) => x.id),
  );
});
test("hiding a module removes it entirely without touching other data", () => {
  let s = blankState("home");
  s.tasks.push({
    id: "t",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    version: 1,
    deletedAt: null,
    title: "Keep me",
    area: "inbox",
    projectId: "",
    status: "todo",
    date: "2026-11-17",
    deadline: "",
    time: "",
    minutes: 0,
    pomodoros: 0,
    note: "",
    priorityDate: "",
    event: false,
    tag: "",
    reminderMinutes: null,
    reminderTime: "09:00",
    repeat: {
      kind: "none",
      interval: 1,
      days: [1],
      until: "",
      monthMode: "date",
      missing: "last",
      month: 1,
      day: 1,
      leap: "regular",
      leapFallback: "regular",
      unit: "months",
    },
    steps: [],
  });
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: {
        homeModules: { hidden: ["priority", "due"], order: [], folded: [] },
      },
    },
    NOW,
  );
  const ids = homeModules(s.settings, "main").map((x) => x.id);
  assert.equal(ids.includes("priority"), false);
  assert.equal(ids.includes("due"), false);
  assert.equal(s.tasks[0].title, "Keep me");
});
test("legacy plan layout is readable but ordering only exposes active modules", () => {
  const s = blankState("home");
  const settings = Settings.parse({
    ...s.settings,
    homeModules: {
      hidden: [],
      order: ["inbox", "lessons", "plan"],
      folded: [],
    },
  });
  assert.deepEqual(
    homeModules(settings, "main")
      .slice(0, 2)
      .map((x) => x.id),
    ["inbox", "lessons"],
  );
  assert.deepEqual(
    homeModules(settings, "main")
      .slice(2)
      .map((x) => x.id),
    ["priority", "schedule", "planned", "carry", "due", "previous", "done"],
  );
});
test("folding is a separate preference from visibility", () => {
  const s = blankState("home");
  const settings = Settings.parse({
    ...s.settings,
    homeModules: {
      hidden: ["due"],
      order: [],
      folded: ["priority", "habits"],
    },
  });
  assert.equal(isFolded(settings, "priority"), true);
  assert.equal(isFolded(settings, "due"), false);
  assert.equal(isFolded(settings, "inbox"), false);
  assert.equal(
    homeModules(settings, "support").some((x) => x.id === "habits"),
    true,
  );
});
test("only known module ids can be stored and reset clears all preferences", () => {
  let s = blankState("home");
  assert.throws(
    () =>
      Settings.parse({
        ...s.settings,
        homeModules: { hidden: ["unknown"], order: [], folded: [] },
      }),
    /Invalid|invalid|option/i,
  );
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: {
        homeModules: {
          hidden: ["due"],
          order: ["inbox"],
          folded: ["priority"],
        },
      },
    },
    NOW,
  );
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: { homeModules: { hidden: [], order: [], folded: [] } },
    },
    NOW,
  );
  assert.deepEqual(s.settings.homeModules, {
    hidden: [],
    order: [],
    folded: [],
  });
  assert.equal(HOME_MODULE_IDS.length, 13);
  assert.equal(HOME_MODULE_IDS.includes("plan"), false);
});

test("old budget layouts and day selections survive backup restore without reviving the card", async () => {
  let state = blankState("synthetic-legacy-layout");
  let now = NOW;
  const run = (a) =>
    (state = applyAction(state, { revision: state.revision, ...a }, now));
  run({
    action: "save",
    collection: "tasks",
    item: {
      title: "Synthetic carried task",
      area: "work",
      date: "2026-11-15",
      deadline: "2026-11-20",
      minutes: 30,
      pomodoros: 2,
    },
  });
  const taskId = state.tasks[0].id;
  run({ action: "plan", command: "pick", date: "2026-11-17", id: taskId });
  run({
    action: "plan",
    command: "capacity",
    date: "2026-11-17",
    item: { availableMinutes: 120 },
  });
  run({
    action: "settings",
    item: {
      homeModules: {
        order: ["plan", "planned", "inbox"],
        hidden: ["plan", "due"],
        folded: ["plan"],
      },
    },
  });
  run({ action: "timer", command: "start", item: { minutes: 5 } });
  const timerId = state.timer.id;
  now += 300000;
  run({ action: "timer", command: "finish", timerId });
  const original = structuredClone(state);
  let global = state;
  const backups = {};
  const unit = {
    async loadAll() {
      return structuredClone({ global, tables: { backups } });
    },
    async setGlobal(v) {
      global = structuredClone(v);
    },
    async putRecord(_t, k, v) {
      backups[k] = structuredClone(v);
    },
    async close() {},
  };
  let service = await createService(unit, () => now);
  const backup = await service.operate({ action: "backup" });
  const restored = await service.operate({
    action: "restoreBackup",
    backup,
    confirm: true,
    revision: state.revision,
  });
  assert.deepEqual(restored.tasks, original.tasks);
  assert.deepEqual(restored.focusLogs, original.focusLogs);
  assert.deepEqual(restored.dayPlans, original.dayPlans);
  assert.deepEqual(
    restored.settings.homeModules,
    original.settings.homeModules,
  );
  const plan = dailyPlan(restored, "2026-11-17");
  assert.ok(plan.todos.some((x) => x.id === taskId));
  assert.equal(
    plan.backlog.some((x) => x.id === taskId),
    false,
  );
  assert.equal(plan.load.availableMinutes, 120);
  assert.equal(restored.tasks[0].minutes, 30);
  assert.equal(restored.tasks[0].pomodoros, 2);
  assert.equal(
    homeModules(restored.settings, "main").some((x) => x.id === "plan"),
    false,
  );
  assert.equal(
    HOME_MODULES.some((x) => x.id === "plan" || x.titleKey === "dailyPlan"),
    false,
  );
  await service.close();
  service = await createService(unit, () => now);
  assert.deepEqual(
    (await service.operate({ action: "read" })).dayPlans,
    original.dayPlans,
  );
  await service.close();
});
