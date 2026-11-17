import test from "node:test";
import assert from "node:assert/strict";
import { blankState, HabitInput } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { habitProgress, habitRule } from "../src/dates.js";
import { todayHabits } from "../src/today-view.js";

const day = "2026-11-17";
const now = Date.parse("2026-11-17T02:00:00Z");
function habit(overrides = {}) {
  return {
    title: "阅读",
    note: "",
    reviewLinked: false,
    plannedDates: [],
    rules: [
      {
        effective: day,
        mode: "duration",
        days: [0, 1, 2, 3, 4, 5, 6],
        target: 30,
        unit: "分钟",
        paused: false,
        ...overrides,
      },
    ],
  };
}
function seed(overrides) {
  return applyAction(
    blankState("synthetic"),
    {
      action: "save",
      collection: "habits",
      revision: 0,
      item: habit(overrides),
    },
    now,
  );
}
const log = (state, value, extra = {}) =>
  applyAction(
    state,
    {
      action: "habitLog",
      revision: state.revision,
      id: state.habits[0].id,
      date: day,
      value,
      ...extra,
    },
    now,
  );

test("a time goal accepts partial minutes and completes at the target", () => {
  let state = seed();
  state = log(state, 12);
  let p = habitProgress(state, state.habits[0], day);
  assert.deepEqual(
    { value: p.value, target: p.target, done: p.done },
    { value: 12, target: 30, done: false },
  );
  state = log(state, 18);
  p = habitProgress(state, state.habits[0], day);
  assert.equal(p.value, 30);
  assert.equal(p.done, true);
  assert.equal(habitRule(state.habits[0], day).mode, "duration");
});
test("minutes are bounded integers and stay separate from quantity limits", () => {
  const state = seed();
  assert.throws(() => log(state, 1441), /1–1440/);
  assert.throws(() => log(state, 12.5), /1–1440/);
  assert.doesNotThrow(() => log(state, 1440));
});
test("duration appears among today's pending habits and can be skipped", () => {
  let state = seed();
  const groups = todayHabits(state, day);
  assert.equal(groups.pending.length, 1);
  state = log(state, 30);
  assert.equal(todayHabits(state, day).done.length, 1);
});
test("removing one partial entry keeps the rest", () => {
  let state = seed();
  state = log(state, 10);
  const first = state.habitLogs.at(-1).id;
  state = log(state, 5);
  state = applyAction(
    state,
    {
      action: "habitLog",
      revision: state.revision,
      id: state.habits[0].id,
      date: day,
      removeId: first,
    },
    now,
  );
  assert.equal(habitProgress(state, state.habits[0], day).value, 5);
});
test("a time goal cannot be finished by saving a daily review", () => {
  let state = seed({ mode: "duration" });
  state.habits[0].reviewLinked = true;
  state = applyAction(
    state,
    {
      action: "review",
      revision: state.revision,
      date: day,
      kind: "day",
      text: "done",
    },
    now,
  );
  assert.equal(state.habitLogs.length, 0);
});
test("the duration target must be whole minutes within a day", () => {
  assert.doesNotThrow(() => HabitInput.parse(habit()));
  assert.throws(() => HabitInput.parse(habit({ target: 0 })));
  assert.throws(() => HabitInput.parse(habit({ target: 1441 })));
  assert.throws(() => HabitInput.parse(habit({ target: 30.5 })));
});
