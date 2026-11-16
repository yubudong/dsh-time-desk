import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { occurrences, shift } from "../src/dates.js";
import { todayTasks } from "../src/today-view.js";
const DAY = "2026-11-16",
  PAST = "2026-11-15",
  NEXT = "2026-11-17",
  NOW = Date.parse("2026-11-16T04:00:00Z");
function fixture() {
  let state = blankState("fixture");
  return {
    get state() {
      return state;
    },
    act(action) {
      state = applyAction(state, { revision: state.revision, ...action }, NOW);
      return state;
    },
    task(item) {
      this.act({ action: "save", collection: "tasks", item });
      return state.tasks.at(-1);
    },
    view(date = DAY) {
      return todayTasks(
        state,
        occurrences(state, shift(date, -365), shift(date, 366)),
        date,
      );
    },
  };
}

test("yesterday unfinished tasks carry into today regardless of today or tomorrow deadlines", () => {
  const f = fixture();
  const a = f.task({ title: "Fixture A", date: PAST, deadline: DAY });
  const b = f.task({ title: "Fixture B", date: PAST, deadline: NEXT });
  const before = structuredClone(f.state);
  const view = f.view();
  assert.deepEqual(
    view.todos.map((x) => x.id),
    [a.id, b.id],
  );
  assert.deepEqual(
    view.todos.map((x) => x.carriedFrom),
    [PAST, PAST],
  );
  assert.equal(view.previousRecurring.length, 0);
  assert.equal(view.due.length, 2);
  assert.deepEqual(f.state, before);
});
test("past timed tasks become actionable todos without creating a new appointment today", () => {
  const f = fixture();
  const old = f.task({
    title: "Past appointment task",
    date: PAST,
    time: "10:00",
  });
  const current = f.task({
    title: "Current appointment task",
    date: DAY,
    time: "11:00",
  });
  const event = f.task({ title: "Past date event", date: PAST, event: true });
  const view = f.view();
  assert.deepEqual(
    view.todos.map((x) => x.id),
    [old.id],
  );
  assert.equal(view.todos[0].time, "10:00");
  assert.equal(view.todos[0].date, PAST);
  assert.equal(view.todos[0].originalDate, PAST);
  assert.deepEqual(
    view.schedule.map((x) => x.id),
    [current.id],
  );
  assert.ok(!view.todos.some((x) => x.id === event.id));
});
test("future starts and unscheduled inbox tasks are not pulled into today", () => {
  const f = fixture();
  f.task({ title: "Future fixture", date: NEXT, deadline: "2026-11-18" });
  f.task({ title: "Inbox fixture", deadline: DAY });
  assert.equal(f.view().todos.length, 0);
  assert.equal(f.view().due.length, 2);
});
test("done deleted skipped and cancelled tasks do not carry forward", () => {
  const f = fixture();
  f.task({ title: "Done fixture", date: PAST, status: "done" });
  const deleted = f.task({ title: "Deleted fixture", date: PAST });
  f.act({ action: "trash", collection: "tasks", id: deleted.id });
  for (const status of ["skipped", "cancelled"]) {
    const task = f.task({
      title: "Closed fixture " + status,
      date: PAST,
      deadline: DAY,
    });
    f.act({ action: "occurrence", id: task.id, originalDate: PAST, status });
  }
  assert.equal(f.view().todos.length, 0);
  assert.equal(f.view().due.length, 0);
});
test("today priority is shown once and yesterday priority does not consume today slots", () => {
  const f = fixture();
  const current = f.task({
    title: "Priority fixture",
    date: PAST,
    priorityDate: DAY,
  });
  const prior = f.task({
    title: "Prior priority fixture",
    date: PAST,
    priorityDate: PAST,
  });
  const view = f.view();
  assert.deepEqual(
    view.priority.map((x) => x.id),
    [current.id],
  );
  assert.deepEqual(
    view.todos.map((x) => x.id),
    [prior.id],
  );
  assert.equal(view.priority[0].carriedFrom, PAST);
  assert.equal(view.previousRecurring.length, 0);
});
test("unfinished one-off tasks older than the calendar window remain actionable", () => {
  const f = fixture();
  const task = f.task({ title: "Old fixture", date: "2023-01-01" });
  assert.deepEqual(
    f.view().todos.map((x) => x.id),
    [task.id],
  );
  assert.equal(f.view().todos[0].originalDate, "2023-01-01");
});
test("explicit single-instance reschedule to the future is respected", () => {
  const f = fixture();
  const task = f.task({ title: "Moved fixture", date: PAST });
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: PAST,
    date: NEXT,
    status: "todo",
  });
  assert.equal(f.view().todos.length, 0);
  const next = f.view(NEXT);
  assert.equal(next.todos.length, 1);
  assert.equal(next.todos[0].id, task.id);
  assert.equal(next.todos[0].date, NEXT);
  assert.equal(next.todos[0].originalDate, PAST);
});
test("finishing and reopening a carried task preserves dates and uses its original occurrence", () => {
  const f = fixture();
  const task = f.task({
    title: "Completion fixture",
    date: PAST,
    deadline: NEXT,
  });
  const row = f.view().todos[0];
  f.act({
    action: "occurrence",
    id: row.id,
    originalDate: row.originalDate,
    status: "done",
  });
  let view = f.view();
  assert.equal(view.todos.length, 0);
  assert.equal(view.completed.length, 1);
  assert.equal(view.completed[0].id, task.id);
  assert.equal(view.completed[0].originalDate, PAST);
  assert.equal(f.state.tasks[0].date, PAST);
  assert.equal(f.state.tasks[0].deadline, NEXT);
  f.act({
    action: "occurrence",
    id: row.id,
    originalDate: row.originalDate,
    status: "todo",
  });
  view = f.view();
  assert.equal(view.todos.length, 1);
  assert.equal(view.completed.length, 0);
  assert.equal(view.todos[0].originalDate, PAST);
});
test("completion-based recurrence carries only its active cycle and advances after completion", () => {
  const f = fixture();
  const task = f.task({
    title: "Interval fixture",
    date: PAST,
    repeat: { kind: "completion", interval: 3, unit: "days" },
  });
  const row = f.view().todos[0];
  assert.equal(row.id, task.id);
  assert.equal(row.originalDate, PAST);
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: row.originalDate,
    status: "done",
  });
  const view = f.view();
  assert.equal(view.todos.length, 0);
  assert.equal(view.completed.length, 1);
  assert.equal(view.previousRecurring.length, 0);
  assert.equal(f.state.tasks[0].date, "2026-11-19");
});
test("calendar recurrence keeps separate current and historical occurrences", () => {
  const f = fixture();
  const task = f.task({
    title: "Daily fixture",
    date: PAST,
    repeat: { kind: "daily" },
  });
  const view = f.view();
  assert.equal(view.todos.length, 1);
  assert.equal(view.todos[0].id, task.id);
  assert.equal(view.todos[0].originalDate, DAY);
  assert.equal(view.previousRecurring.length, 1);
  assert.equal(view.previousRecurring[0].originalDate, PAST);
});
test("passing the deadline does not remove an unfinished task", () => {
  const f = fixture();
  const task = f.task({
    title: "Late fixture",
    date: "2026-11-13",
    deadline: "2026-11-14",
  });
  assert.equal(f.view().todos[0].id, task.id);
  assert.equal(f.view().due[0].id, task.id);
});
