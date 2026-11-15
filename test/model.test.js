import test from "node:test";
import assert from "node:assert/strict";
import { blankState, TaskInput } from "../src/schema.js";
import {
  applyAction,
  createService,
  timerSeconds,
  validateState,
} from "../src/model.js";
import {
  occurrences,
  ruleDates,
  lunarLabel,
  today,
  habitProgress,
  habitDue,
  zonedStamp,
} from "../src/dates.js";
const NOW = Date.parse("2026-11-15T02:00:00Z");
function harness() {
  let s = blankState("test-device");
  return {
    get state() {
      return s;
    },
    do(a, now = NOW) {
      s = applyAction(s, { revision: s.revision, ...a }, now);
      return s;
    },
    task(item) {
      this.do({ action: "save", collection: "tasks", item });
      return s.tasks.at(-1);
    },
    habit(rule = {}) {
      this.do({
        action: "save",
        collection: "habits",
        item: {
          title: "测试习惯",
          rules: [
            {
              effective: "2026-11-01",
              mode: "daily",
              days: [0, 1, 2, 3, 4, 5, 6],
              target: 1,
              unit: "次",
              paused: false,
              ...rule,
            },
          ],
        },
      });
      return s.habits.at(-1);
    },
  };
}
function unit() {
  let global = null;
  const tables = { backups: {} };
  return {
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
    get state() {
      return global;
    },
  };
}

test("blank state is private, isolated and has no personal sample data", () => {
  const a = blankState("a"),
    b = blankState("b");
  a.tasks.push({});
  assert.equal(b.tasks.length, 0);
  assert.equal(b.timer, null);
  assert.equal(b.schemaVersion, 1);
});
test("invalid dates and impossible times are refused", () => {
  const h = harness();
  assert.throws(() => h.task({ title: "bad", date: "2026-02-30" }));
  assert.throws(() => h.task({ title: "bad", time: "10:00" }));
  assert.throws(() =>
    h.task({ title: "bad", date: "2026-11-15", time: "25:00" }),
  );
});
test("task defaults are fully normalized", () => {
  const a = TaskInput.parse({ title: "Task" });
  assert.equal(a.repeat.kind, "none");
  assert.equal(a.repeat.interval, 1);
});
test("projects support progress and task associations", () => {
  const h = harness();
  h.do({
    action: "save",
    collection: "projects",
    item: { title: "Article", group: "Writing" },
  });
  const p = h.state.projects[0];
  const t = h.task({ title: "Draft", projectId: p.id, area: "work" });
  assert.equal(t.projectId, p.id);
  h.do({
    action: "save",
    collection: "tasks",
    id: t.id,
    item: { status: "doing" },
  });
  assert.equal(h.state.tasks[0].status, "doing");
  assert.throws(() => h.task({ title: "Missing", projectId: "no" }));
});
test("conflicting revision rejects without mutating input", () => {
  const h = harness();
  h.task({ title: "One" });
  assert.throws(
    () =>
      h.do({
        action: "save",
        revision: 0,
        collection: "tasks",
        item: { title: "Two" },
      }),
    /更新/,
  );
  assert.equal(h.state.tasks.length, 1);
});
test("request retry is idempotent before revision conflict", () => {
  const h = harness();
  h.do({
    action: "save",
    collection: "tasks",
    requestId: "same",
    item: { title: "One" },
  });
  h.do({
    action: "save",
    revision: 0,
    collection: "tasks",
    requestId: "same",
    item: { title: "One" },
  });
  assert.equal(h.state.tasks.length, 1);
  assert.equal(h.state.revision, 1);
});
test("limits daily priorities to three", () => {
  const h = harness();
  for (let i = 0; i < 3; i++)
    h.task({ title: "Task " + i, priorityDate: "2026-11-15" });
  assert.throws(
    () => h.task({ title: "Fourth", priorityDate: "2026-11-15" }),
    /三件/,
  );
});
test("monthly missing date policy clamps or skips explicitly", () => {
  for (const missing of ["last", "skip"]) {
    const h = harness();
    const t = h.task({
      title: "Monthly",
      date: "2026-01-31",
      repeat: { kind: "monthly", missing },
    });
    assert.deepEqual(
      ruleDates(t, "2026-02-01", "2026-03-31"),
      missing === "last" ? ["2026-02-28", "2026-03-31"] : ["2026-03-31"],
    );
  }
});
test("weekly schedule honors Sunday=0 and bounds", () => {
  const h = harness();
  const t = h.task({
    title: "Repeat",
    date: "2026-11-01",
    repeat: { kind: "weekly", days: [0], until: "2026-11-15" },
  });
  assert.deepEqual(ruleDates(t, "2026-11-01", "2026-11-30"), [
    "2026-11-01",
    "2026-11-08",
    "2026-11-15",
  ]);
});
test("last weekday monthly excludes weekends", () => {
  const h = harness();
  const t = h.task({
    title: "Accounts",
    date: "2026-11-01",
    repeat: { kind: "monthly", monthMode: "lastWeekday" },
  });
  assert.deepEqual(ruleDates(t, "2026-11-01", "2026-12-31"), [
    "2026-11-30",
    "2026-12-31",
  ]);
});
test("lunar new year converts into distinct solar dates", () => {
  const h = harness();
  const t = h.task({
    title: "Lunar",
    date: "2026-01-01",
    repeat: {
      kind: "lunar",
      month: 1,
      day: 1,
      leap: "regular",
      missing: "last",
    },
  });
  assert.deepEqual(ruleDates(t, "2026-01-01", "2027-12-31"), [
    "2026-02-17",
    "2027-02-06",
  ]);
  assert.match(lunarLabel("2026-02-17"), /正月初一/);
});
test("leap month policy supports both and fallback", () => {
  const h = harness();
  const t = h.task({
    title: "Leap",
    date: "2025-01-01",
    repeat: { kind: "lunar", month: 6, day: 1, leap: "both" },
  });
  assert.equal(ruleDates(t, "2025-01-01", "2025-12-31").length, 2);
  t.repeat.leap = "only";
  t.repeat.leapFallback = "skip";
  assert.equal(ruleDates(t, "2026-01-01", "2026-12-31").length, 0);
  t.repeat.leapFallback = "regular";
  assert.equal(ruleDates(t, "2026-01-01", "2026-12-31").length, 1);
});
test("single reschedule preserves original identity and all other occurrences", () => {
  const h = harness();
  const t = h.task({
    title: "Weekly",
    date: "2026-11-06",
    repeat: { kind: "weekly", days: [5] },
  });
  h.do({
    action: "occurrence",
    id: t.id,
    originalDate: "2026-11-13",
    date: "2026-11-14",
    status: "todo",
  });
  const list = occurrences(h.state, "2026-11-01", "2026-11-30");
  assert.deepEqual(
    list.map((x) => x.date),
    ["2026-11-06", "2026-11-14", "2026-11-20", "2026-11-27"],
  );
  assert.equal(
    occurrences(h.state, "2026-11-14", "2026-11-14")[0].originalDate,
    "2026-11-13",
  );
});
test("split recurrence keeps earlier completed history", () => {
  const h = harness();
  const t = h.task({
    title: "Weekly",
    date: "2026-11-06",
    repeat: { kind: "weekly", days: [5] },
  });
  h.do({
    action: "occurrence",
    id: t.id,
    originalDate: "2026-11-06",
    status: "done",
  });
  h.do({
    action: "splitSeries",
    id: t.id,
    originalDate: "2026-11-13",
    item: {
      date: "2026-11-14",
      repeat: { kind: "weekly", days: [6] },
      title: "Saturday",
    },
  });
  const list = occurrences(h.state, "2026-11-01", "2026-11-30");
  assert.equal(list.find((x) => x.date === "2026-11-06").status, "done");
  assert.equal(list.filter((x) => x.title === "Saturday").length, 3);
});
test("completion based repeat moves from actual completion, not old due date", () => {
  const h = harness();
  const t = h.task({
    title: "Filter",
    date: "2026-09-01",
    repeat: { kind: "completion", interval: 6, unit: "months" },
  });
  h.do({
    action: "occurrence",
    id: t.id,
    originalDate: "2026-09-01",
    status: "done",
  });
  assert.equal(h.state.tasks[0].date, "2027-05-15");
  assert.equal(h.state.occurrences[0].status, "done");
});
test("quantity habit increments, supports log removal and disallows future", () => {
  const h = harness();
  const habit = h.habit({ mode: "quantity", target: 1000, unit: "个" });
  h.do({ action: "habitLog", id: habit.id, date: "2026-11-15", value: 600 });
  h.do({ action: "habitLog", id: habit.id, date: "2026-11-15", value: 400 });
  assert.equal(habitProgress(h.state, habit, "2026-11-15").done, true);
  h.do({
    action: "habitLog",
    id: habit.id,
    date: "2026-11-15",
    removeId: h.state.habitLogs[1].id,
  });
  assert.equal(habitProgress(h.state, habit, "2026-11-15").value, 600);
  assert.throws(
    () => h.do({ action: "habitLog", id: habit.id, date: "2026-11-16" }),
    /提前/,
  );
});
test("weekly habit logs one completion per date", () => {
  const h = harness();
  const habit = h.habit({ mode: "weekly", target: 3 });
  assert.equal(habitDue(habit, "2026-11-15"), true);
  h.do({ action: "habitLog", id: habit.id, date: "2026-11-14" });
  assert.throws(
    () => h.do({ action: "habitLog", id: habit.id, date: "2026-11-14" }),
    /已打卡/,
  );
  h.do({ action: "habitLog", id: habit.id, date: "2026-11-15" });
  assert.equal(h.state.habitLogs.length, 2);
});
test("habit rule changes preserve historical goals", () => {
  const h = harness();
  const habit = h.habit({ mode: "quantity", target: 1000 });
  h.do({
    action: "save",
    collection: "habits",
    id: habit.id,
    item: {
      rules: [
        ...habit.rules,
        { ...habit.rules[0], effective: "2026-11-15", target: 500 },
      ],
    },
  });
  h.do({ action: "habitLog", id: habit.id, date: "2026-11-14", value: 600 });
  assert.equal(
    habitProgress(h.state, h.state.habits[0], "2026-11-14").done,
    false,
  );
  assert.throws(
    () =>
      h.do({
        action: "save",
        collection: "habits",
        id: habit.id,
        item: { rules: [{ ...habit.rules[0], target: 400 }] },
      }),
    /过去/,
  );
});
test("daily review links check-in only once", () => {
  const h = harness();
  const habit = h.habit();
  h.do({
    action: "save",
    collection: "habits",
    id: habit.id,
    item: { reviewLinked: true },
  });
  h.do({
    action: "review",
    kind: "day",
    date: "2026-11-15",
    text: "A good day",
  });
  h.do({ action: "review", kind: "day", date: "2026-11-15", text: "Updated" });
  assert.equal(h.state.habitLogs.length, 1);
});
test("focus pause excludes paused duration and resumes correctly", () => {
  const h = harness();
  h.do({ action: "timer", command: "start" });
  let timer = h.state.timer;
  h.do({ action: "timer", command: "pause", timerId: timer.id }, NOW + 60000);
  assert.equal(timerSeconds(h.state.timer, NOW + 600000), 60);
  h.do({ action: "timer", command: "resume", timerId: timer.id }, NOW + 600000);
  h.do({ action: "timer", command: "finish", timerId: timer.id }, NOW + 660000);
  assert.equal(h.state.focusLogs[0].seconds, 120);
  assert.equal(h.state.timer, null);
});
test("focus cannot double start, and completion is capped to a single round", () => {
  const h = harness();
  h.do({ action: "timer", command: "start" });
  assert.throws(() => h.do({ action: "timer", command: "start" }), /结束/);
  const id = h.state.timer.id;
  h.do({ action: "timer", command: "finish", timerId: id }, NOW + 3 * 3600000);
  assert.equal(h.state.focusLogs[0].seconds, 1500);
  assert.equal(h.state.focusLogs.length, 1);
  assert.throws(
    () => h.do({ action: "timer", command: "finish", timerId: id }),
    /更新/,
  );
});
test("focus can be adjusted after interruption without completing task", () => {
  const h = harness();
  const task = h.task({ title: "Write" });
  h.do({ action: "timer", command: "start", taskId: task.id });
  h.do(
    {
      action: "timer",
      command: "finish",
      timerId: h.state.timer.id,
      seconds: 90,
    },
    NOW + 120000,
  );
  assert.equal(h.state.focusLogs[0].seconds, 90);
  assert.equal(h.state.tasks[0].status, "todo");
});
test("date-only records remain dates across time zones and DST invalid local times reject", () => {
  assert.equal(
    today("Asia/Singapore", Date.parse("2026-11-14T18:00:00Z")),
    "2026-11-15",
  );
  assert.equal(
    today("America/Los_Angeles", Date.parse("2026-11-14T18:00:00Z")),
    "2026-11-14",
  );
  assert.throws(
    () => zonedStamp("2026-03-08", "02:30", "America/New_York"),
    /不存在/,
  );
});
test("trash and restore preserve record IDs", () => {
  const h = harness();
  const t = h.task({ title: "Task", date: "2026-11-15" });
  h.do({ action: "trash", collection: "tasks", id: t.id });
  assert.equal(occurrences(h.state, "2026-11-15", "2026-11-15").length, 0);
  h.do({ action: "restore", collection: "tasks", id: t.id });
  assert.equal(h.state.tasks[0].id, t.id);
  assert.equal(occurrences(h.state, "2026-11-15", "2026-11-15").length, 1);
});
test("service serializes writers and persisted data survives reopening", async () => {
  const u = unit(),
    s = await createService(u, () => NOW);
  const requests = await Promise.allSettled([
    s.operate({
      action: "save",
      revision: 0,
      collection: "tasks",
      item: { title: "One" },
    }),
    s.operate({
      action: "save",
      revision: 0,
      collection: "tasks",
      item: { title: "Two" },
    }),
  ]);
  assert.equal(requests.filter((x) => x.status === "fulfilled").length, 1);
  const reopened = await createService(u, () => NOW);
  assert.equal((await reopened.operate({ action: "read" })).tasks.length, 1);
});
test("backup restore validates before overwrite and keeps a pre-import copy", async () => {
  const u = unit(),
    s = await createService(u, () => NOW);
  await s.operate({
    action: "save",
    revision: 0,
    collection: "tasks",
    item: { title: "Original" },
  });
  const backup = await s.operate({ action: "backup" });
  await assert.rejects(
    s.operate({
      action: "restoreBackup",
      revision: 1,
      confirm: true,
      backup: { format: "dsh-life-desk", state: {} },
    }),
  );
  assert.equal(u.state.tasks[0].title, "Original");
  const h = harness();
  h.task({ title: "Imported" });
  await s.operate({
    action: "restoreBackup",
    revision: 1,
    confirm: true,
    backup: { ...backup, state: h.state },
  });
  assert.equal(u.state.tasks[0].title, "Imported");
  await s.operate({ action: "restorePrevious", revision: 2, confirm: true });
  assert.equal(u.state.tasks[0].title, "Original");
});
test("malformed backup associations and duplicate IDs reject", () => {
  const h = harness();
  h.task({ title: "One" });
  const s = structuredClone(h.state);
  s.tasks.push(s.tasks[0]);
  assert.throws(() => validateState(s), /重复 ID/);
});
test("failed durable write leaves service state unchanged", async () => {
  const u = unit();
  u.setGlobal = async () => {
    throw new Error("disk full");
  };
  const s = await createService(u, () => NOW);
  await assert.rejects(
    s.operate({
      action: "save",
      revision: 0,
      collection: "tasks",
      item: { title: "No" },
    }),
    /disk full/,
  );
  assert.equal((await s.operate({ action: "read" })).tasks.length, 0);
});
