import test from "node:test";
import assert from "node:assert/strict";
import { blankState, State } from "../src/schema.js";
import { applyAction, createService } from "../src/model.js";
import { dailyPlan, inboxTasks, estimateTask } from "../src/planning.js";
const date = "2026-11-16",
  now = Date.parse(date + "T04:00:00Z");
function add(s, item) {
  return applyAction(
    s,
    { action: "save", collection: "tasks", revision: s.revision, item },
    now,
  );
}
function act(s, a) {
  return applyAction(s, { revision: s.revision, ...a }, now);
}
test("legacy state gets empty plans and incomplete capture goes to Inbox", () => {
  const legacy = blankState("synthetic");
  delete legacy.dayPlans;
  let s = State.parse(legacy);
  assert.deepEqual(s.dayPlans, []);
  s = add(s, { title: "Capture" });
  assert.equal(inboxTasks(s).length, 1);
  s = act(s, {
    action: "save",
    collection: "tasks",
    id: s.tasks[0].id,
    item: { area: "work" },
  });
  assert.equal(inboxTasks(s).length, 0);
  assert.equal(s.tasks[0].date, "");
});
test("carried tasks stay outside daily load until picked without changing dates or deadlines", () => {
  let s = add(blankState("synthetic"), {
    title: "Older",
    date: "2026-11-15",
    deadline: "2026-11-17",
    minutes: 45,
  });
  const task = s.tasks[0];
  let p = dailyPlan(s, date);
  assert.equal(p.backlog.length, 1);
  assert.equal(p.load.knownMinutes, 0);
  s = act(s, { action: "plan", command: "pick", date, id: task.id });
  p = dailyPlan(s, date);
  assert.equal(p.backlog.length, 0);
  assert.equal(p.todos.length, 1);
  assert.equal(p.load.knownMinutes, 45);
  assert.deepEqual(s.tasks[0], task);
  s = act(s, { action: "plan", command: "unpick", date, id: task.id });
  assert.equal(dailyPlan(s, date).backlog.length, 1);
  assert.deepEqual(s.tasks[0], task);
  assert.equal(dailyPlan(s, "2026-11-17").load.knownMinutes, 0);
});
test("load deduplicates timed priorities, gives minutes precedence and reports unknowns", () => {
  let s = blankState("synthetic");
  s = add(s, {
    title: "Timed priority",
    date,
    time: "09:00",
    priorityDate: date,
    minutes: 60,
    pomodoros: 3,
  });
  s = add(s, { title: "Focus estimate", date, pomodoros: 2 });
  s = add(s, { title: "Unknown", date });
  s = add(s, { title: "Tomorrow", date: "2026-11-17", minutes: 100 });
  const p = dailyPlan(s, date);
  assert.equal(p.load.taskCount, 3);
  assert.equal(p.load.knownMinutes, 110);
  assert.equal(p.load.unknownCount, 1);
  assert.equal(p.load.pomodoroCount, 1);
  assert.equal(p.load.availableMinutes, null);
  assert.deepEqual(estimateTask({ minutes: 20, pomodoros: 5 }, 45), {
    minutes: 20,
    basis: "minutes",
  });
});
test("daily capacity supports zero, unset, conflicts and idempotent retries", () => {
  let s = blankState("synthetic");
  const a = {
    action: "plan",
    command: "capacity",
    date,
    item: { availableMinutes: 0 },
    requestId: "same-request",
    revision: 0,
  };
  s = applyAction(s, a, now);
  assert.equal(dailyPlan(s, date).load.availableMinutes, 0);
  assert.equal(applyAction(s, a, now).revision, 1);
  assert.throws(
    () => applyAction(s, { ...a, requestId: "different" }, now),
    /更新/,
  );
  assert.throws(() =>
    act(s, {
      ...a,
      revision: s.revision,
      requestId: "bad",
      item: { availableMinutes: 1441 },
    }),
  );
  s = act(s, {
    action: "plan",
    command: "capacity",
    date,
    item: { availableMinutes: null },
  });
  assert.equal(dailyPlan(s, date).load.availableMinutes, null);
});
test("completion removes picked load and preserves the original occurrence identity", () => {
  let s = add(blankState("synthetic"), {
    title: "Carry",
    date: "2026-11-15",
    minutes: 30,
  });
  const id = s.tasks[0].id;
  s = act(s, { action: "plan", command: "pick", date, id });
  s = act(s, {
    action: "occurrence",
    id,
    originalDate: "2026-11-15",
    status: "done",
  });
  const p = dailyPlan(s, date);
  assert.equal(p.load.knownMinutes, 0);
  assert.equal(p.completed.length, 1);
  assert.equal(p.completed[0].originalDate, "2026-11-15");
  s = act(s, {
    action: "occurrence",
    id,
    originalDate: "2026-11-15",
    status: "todo",
  });
  assert.equal(dailyPlan(s, date).load.knownMinutes, 30);
});
test("future or explicitly rescheduled tasks cannot be picked as carried work", () => {
  let s = add(blankState("synthetic"), { title: "Future", date: "2026-11-17" });
  assert.throws(
    () => act(s, { action: "plan", command: "pick", date, id: s.tasks[0].id }),
    /延续/,
  );
});
test("rescheduling a picked task to the future removes it from this day without creating another occurrence", () => {
  let s = add(blankState("synthetic"), {
    title: "Carry",
    date: "2026-11-15",
    minutes: 30,
  });
  const id = s.tasks[0].id;
  s = act(s, { action: "plan", command: "pick", date, id });
  s = act(s, {
    action: "occurrence",
    id,
    originalDate: "2026-11-15",
    date: "2026-11-17",
  });
  assert.equal(dailyPlan(s, date).load.taskCount, 0);
  assert.throws(
    () => act(s, { action: "plan", command: "pick", date, id }),
    /延续/,
  );
  assert.equal(s.occurrences.length, 1);
});
test("real service persists plans, restores backups and shares full plan reads", async () => {
  let global = null;
  const tables = { backups: {} };
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
  let svc = await createService(unit, () => now);
  await svc.operate({
    action: "plan",
    command: "capacity",
    date,
    revision: 0,
    item: { availableMinutes: 120 },
  });
  const backup = await svc.operate({ action: "backup" });
  await svc.close();
  svc = await createService(unit, () => now);
  assert.equal(
    (await svc.operate({ action: "plan", command: "read", date })).load
      .availableMinutes,
    120,
  );
  await svc.operate({
    action: "restoreBackup",
    revision: 1,
    confirm: true,
    backup,
  });
  assert.equal((await svc.operate({ action: "read" })).dayPlans.length, 1);
  await svc.close();
});
