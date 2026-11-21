import test from "node:test";
import assert from "node:assert/strict";
import { blankState, State } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { todayTasks, todayHabits, taskFocus } from "../src/today-view.js";
import { occurrences, habitProgress } from "../src/dates.js";
const now = Date.parse("2026-11-15T04:00:00Z"),
  date = "2026-11-15";
function fixture() {
  let s = blankState("test");
  return {
    get s() {
      return s;
    },
    act(a, time = now) {
      s = applyAction(s, { revision: s.revision, ...a }, time);
      return s;
    },
    task(item) {
      this.act({ action: "save", collection: "tasks", item });
      return s.tasks.at(-1);
    },
    habit(mode = "daily", target = 1) {
      this.act({
        action: "save",
        collection: "habits",
        item: {
          title: "Habit",
          rules: [
            {
              effective: "2026-11-01",
              mode,
              target,
              days: [0, 1, 2, 3, 4, 5, 6],
            },
          ],
        },
      });
      return s.habits.at(-1);
    },
  };
}
test("old records normalize optional fields without losing data", () => {
  const f = fixture();
  f.task({ title: "Keep me" });
  f.habit();
  const old = structuredClone(f.s);
  delete old.tasks[0].pomodoros;
  delete old.habits[0].plannedDates;
  const result = State.parse(old);
  assert.equal(result.tasks[0].title, "Keep me");
  assert.equal(result.tasks[0].pomodoros, 0);
  assert.deepEqual(result.habits[0].plannedDates, []);
});
test("task tomato estimates vary and partial rounds never fill tomatoes", () => {
  const f = fixture();
  const t = f.task({ title: "Draft", pomodoros: 3 });
  f.act({ action: "timer", command: "start", taskId: t.id });
  assert.equal(taskFocus(f.s, t).running, true);
  f.act(
    { action: "timer", command: "finish", timerId: f.s.timer.id },
    now + 100000,
  );
  assert.equal(taskFocus(f.s, t).completed, 0);
  f.act({ action: "timer", command: "start", taskId: t.id });
  f.act(
    { action: "timer", command: "finish", timerId: f.s.timer.id },
    now + 1500000,
  );
  assert.deepEqual(taskFocus(f.s, t), {
    expected: 3,
    completed: 1,
    running: false,
  });
  assert.equal(f.s.tasks[0].status, "todo");
});
test("recurring task progress is counted independently for each occurrence", () => {
  const f = fixture();
  const t = f.task({
    title: "Daily",
    date,
    repeat: { kind: "daily" },
    pomodoros: 2,
  });
  f.act({
    action: "timer",
    command: "start",
    taskId: t.id,
    originalDate: date,
  });
  f.act(
    { action: "timer", command: "finish", timerId: f.s.timer.id },
    now + 1500000,
  );
  assert.equal(taskFocus(f.s, t, date).completed, 1);
  assert.equal(taskFocus(f.s, t, "2026-11-16").completed, 0);
});
test("priority tasks are excluded from normal todo list but retained in timeline", () => {
  const f = fixture();
  f.task({ title: "Priority timed", date, time: "10:00", priorityDate: date });
  f.task({ title: "Priority anytime", date, priorityDate: date });
  f.task({ title: "Life", date, area: "life" });
  const g = todayTasks(f.s, occurrences(f.s, date, date), date);
  assert.equal(g.priority.length, 2);
  assert.equal(g.schedule.length, 1);
  assert.deepEqual(
    g.todos.map((x) => x.title),
    ["Life"],
  );
});
test("deadline-only tasks and overdue deadlines are surfaced without scheduling them", () => {
  const f = fixture();
  f.task({ title: "Due", deadline: date });
  f.task({ title: "Past", deadline: "2026-11-14" });
  f.task({ title: "Later", deadline: "2026-12-01" });
  const g = todayTasks(f.s, [], date);
  assert.deepEqual(
    g.due.map((x) => x.title),
    ["Past", "Due"],
  );
  assert.equal(g.todos.length, 0);
  assert.equal(f.s.tasks[0].date, "");
});
test("weekly targets stay outside today until explicitly planned", () => {
  const f = fixture();
  const h = f.habit("weekly", 3);
  assert.equal(todayHabits(f.s, date).pending.length, 0);
  assert.equal(todayHabits(f.s, date).weekly.length, 1);
  f.act({ action: "habitLog", id: h.id, date, status: "planned" });
  assert.equal(todayHabits(f.s, date).pending.length, 1);
  assert.equal(f.s.habitLogs.length, 0);
  f.act({ action: "habitLog", id: h.id, date, value: 1 });
  assert.equal(todayHabits(f.s, date).pending.length, 0);
  assert.equal(todayHabits(f.s, date).done.length, 1);
  assert.equal(habitProgress(f.s, h, date).done, true);
  assert.equal(todayHabits(f.s, "2026-11-16").pending.length, 0);
});
test("planning can be removed and future scheduling does not pre-complete habits", () => {
  const f = fixture();
  const h = f.habit("weekly", 3);
  f.act({
    action: "habitLog",
    id: h.id,
    date: "2026-11-20",
    status: "planned",
  });
  assert.equal(todayHabits(f.s, "2026-11-20").pending.length, 1);
  f.act({
    action: "habitLog",
    id: h.id,
    date: "2026-11-20",
    status: "unplanned",
  });
  assert.equal(todayHabits(f.s, "2026-11-20").pending.length, 0);
  assert.equal(f.s.habitLogs.length, 0);
});
test("partial quantities remain pending, missed and skipped are distinct non-completions", () => {
  const f = fixture();
  const q = f.habit("quantity", 1000);
  f.act({ action: "habitLog", id: q.id, date, value: 600 });
  assert.equal(todayHabits(f.s, date).pending.length, 1);
  assert.equal(habitProgress(f.s, q, date).value, 600);
  const h = f.habit();
  f.act({ action: "habitLog", id: h.id, date, status: "missed" });
  const p = habitProgress(f.s, h, date);
  assert.equal(p.missed, true);
  assert.equal(p.skipped, false);
  assert.equal(p.done, false);
  assert.equal(todayHabits(f.s, date).settled.length, 1);
  f.act({ action: "habitLog", id: h.id, date, value: 1 });
  assert.equal(habitProgress(f.s, h, date).missed, false);
  assert.equal(habitProgress(f.s, h, date).done, true);
});
test("partial work is preserved when the rest of the habit is skipped", () => {
  const f = fixture();
  const h = f.habit("quantity", 1000);
  f.act({ action: "habitLog", id: h.id, date, value: 600 });
  f.act({ action: "habitLog", id: h.id, date, skipped: true });
  assert.equal(habitProgress(f.s, h, date).value, 600);
  assert.equal(todayHabits(f.s, date).settled.length, 1);
  f.act({ action: "habitLog", id: h.id, date, value: 400 });
  assert.equal(habitProgress(f.s, h, date).done, true);
  assert.equal(habitProgress(f.s, h, date).skipped, false);
});
test("yesterday incomplete habits do not create extra obligations today", () => {
  const f = fixture();
  f.habit();
  assert.equal(todayHabits(f.s, date).pending.length, 1);
  assert.equal(todayHabits(f.s, "2026-11-16").pending.length, 1);
});

test("completing a recurring scheduled task removes its deadline and undo restores it", () => {
  const f = fixture();
  const task = f.task({
    title: "Synthetic monthly bill",
    date,
    deadline: date,
    repeat: { kind: "monthly", day: 15 },
  });
  const view = () => todayTasks(f.s, occurrences(f.s, date, date), date);
  assert.equal(view().todos.length, 1);
  assert.equal(view().due.length, 1);
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: date,
    status: "done",
  });
  assert.equal(view().todos.length, 0);
  assert.equal(view().completed.length, 1);
  assert.equal(view().due.length, 0);
  assert.equal(f.s.tasks[0].status, "todo");
  assert.equal(f.s.tasks[0].deadline, date);
  assert.equal(occurrences(f.s, "2026-12-15", "2026-12-15")[0].status, "todo");
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: date,
    status: "todo",
  });
  assert.equal(view().due.length, 1);
  assert.equal(view().todos.length, 1);
});

test("a future recurrence completion never suppresses an earlier unpaid deadline", () => {
  const f = fixture();
  const task = f.task({
    title: "Synthetic recurring payment",
    date,
    deadline: date,
    repeat: { kind: "monthly", day: 15 },
  });
  f.act(
    {
      action: "occurrence",
      id: task.id,
      originalDate: "2026-12-15",
      status: "done",
    },
    Date.parse("2026-12-15T04:00:00Z"),
  );
  assert.equal(todayTasks(f.s, [], date).due.length, 1);
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: date,
    status: "done",
  });
  assert.equal(todayTasks(f.s, [], date).due.length, 0);
});

test("rescheduled recurring instances resolve deadlines by original identity", () => {
  const f = fixture();
  const task = f.task({
    title: "Synthetic rescheduled bill",
    date,
    deadline: date,
    repeat: { kind: "monthly", day: 15 },
  });
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: date,
    date: "2026-11-16",
  });
  assert.equal(todayTasks(f.s, [], date).due.length, 1);
  f.act(
    { action: "occurrence", id: task.id, originalDate: date, status: "done" },
    now + 86400000,
  );
  assert.equal(todayTasks(f.s, [], "2026-11-16").due.length, 0);
  const restored = State.parse(JSON.parse(JSON.stringify(f.s)));
  assert.equal(todayTasks(restored, [], "2026-11-16").due.length, 0);
  const tombstoned = structuredClone(restored);
  tombstoned.occurrences[0].deletedAt = new Date(now).toISOString();
  assert.equal(todayTasks(tombstoned, [], "2026-11-16").due.length, 1);
});
