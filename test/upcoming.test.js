import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { dailyPlan, deadlineDays, upcomingPlans } from "../src/planning.js";
const NOW = Date.parse("2026-11-15T02:00:00Z");
function harness() {
  let s = blankState("upcoming");
  const doIt = (a) => {
    s = applyAction(s, { revision: s.revision, ...a }, NOW);
    return s;
  };
  const task = (item) =>
    doIt({ action: "save", collection: "tasks", item }).tasks.at(-1);
  const lesson = (item) => doIt({ action: "lesson", item }).lessons.at(-1);
  return {
    get state() {
      return s;
    },
    doIt,
    task,
    lesson,
  };
}
test("deadline days distinguish overdue, today and the coming week", () => {
  assert.equal(deadlineDays({ deadline: "2026-11-13" }, "2026-11-15"), -2);
  assert.equal(deadlineDays({ deadline: "2026-11-15" }, "2026-11-15"), 0);
  assert.equal(deadlineDays({ deadline: "2026-11-18" }, "2026-11-15"), 3);
});
test("future plans contain timed tasks and moved lessons, not deadline-only tasks", () => {
  const h = harness();
  h.task({
    title: "Timed",
    date: "2026-11-16",
    time: "10:00",
  });
  h.task({
    title: "Deadline only",
    deadline: "2026-11-21",
  });
  h.task({
    title: "All-day event",
    date: "2026-11-20",
    event: true,
  });
  h.task({
    title: "Already done",
    date: "2026-11-17",
    time: "09:00",
    status: "done",
  });
  const piano = h.lesson({
    title: "Piano",
    participant: "Child",
    weekdays: [1],
    time: "19:00",
    durationMinutes: 60,
    effective: "2026-11-09",
  });
  h.doIt({
    action: "lessonSession",
    command: "save",
    id: piano.id,
    originalDate: "2026-11-16",
    date: "2026-11-18",
    time: "19:00",
  });
  const skipped = h.lesson({
    title: "Skipped",
    weekdays: [2],
    time: "17:00",
    effective: "2026-11-03",
  });
  h.doIt({
    action: "lessonSession",
    command: "skip",
    id: skipped.id,
    originalDate: "2026-11-17",
  });
  const plans = upcomingPlans(h.state, "2026-11-15", 7);
  assert.deepEqual(
    plans.map((x) => [x.kind, x.date, x.time, x.title]),
    [
      ["task", "2026-11-16", "10:00", "Timed"],
      ["lesson", "2026-11-18", "19:00", "Piano"],
      ["task", "2026-11-20", "", "All-day event"],
    ],
  );
  assert.equal(
    plans.some((x) => x.title === "Deadline only"),
    false,
  );
  assert.equal(
    plans.some((x) => x.title === "Already done"),
    false,
  );
  assert.equal(
    plans.some((x) => x.title === "Skipped"),
    false,
  );
});
test("a task with only a deadline belongs in deadlines, not in future plans", () => {
  const h = harness();
  h.task({ title: "Deadline only", deadline: "2026-11-21" });
  const plan = dailyPlan(h.state, "2026-11-15");
  assert.equal(
    plan.due.some((x) => x.title === "Deadline only"),
    true,
  );
  assert.equal(upcomingPlans(h.state, "2026-11-15", 7).length, 0);
});
test("future plans stay inside the seven-day window and keep time order", () => {
  const h = harness();
  h.task({ title: "Later", date: "2026-11-22", time: "18:00" });
  h.task({ title: "Sooner", date: "2026-11-16", time: "08:00" });
  h.task({ title: "Outside", date: "2026-11-24", time: "09:00" });
  const plans = upcomingPlans(h.state, "2026-11-15", 7);
  assert.deepEqual(
    plans.map((x) => x.title),
    ["Sooner", "Later"],
  );
});
