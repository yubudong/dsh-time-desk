import test from "node:test";
import assert from "node:assert/strict";
import { blankState, HabitInput, State } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { HABIT_TEMPLATES, habitFromTemplate } from "../src/habit-templates.js";
const t = (k) => "text:" + k;
const day = "2026-11-17";
const now = Date.parse("2026-11-17T02:00:00Z");
test("every template produces a valid habit without saving it", () => {
  for (const tpl of HABIT_TEMPLATES) {
    const habit = habitFromTemplate(tpl, day, t);
    assert.doesNotThrow(() => HabitInput.parse(habit), tpl.id);
    assert.equal(habit.rules[0].effective, day);
    assert.equal("period" in habit, false);
    assert.deepEqual(habit.plannedDates, []);
    assert.equal(habit.id, undefined);
  }
});
test("review templates are honest about what can be linked", () => {
  const daily = HABIT_TEMPLATES.find((x) => x.id === "dailyReview");
  const weekly = HABIT_TEMPLATES.find((x) => x.id === "weeklyReview");
  assert.equal(habitFromTemplate(daily, day, t).reviewLinked, true);
  assert.equal(habitFromTemplate(weekly, day, t).reviewLinked, false);
  assert.equal(habitFromTemplate(weekly, day, t).rules[0].mode, "weekly");
  assert.equal(habitFromTemplate(weekly, day, t).rules[0].target, 1);
});
test("a template is only created when the form is saved", () => {
  let state = blankState("synthetic");
  state = applyAction(
    state,
    {
      action: "save",
      collection: "habits",
      revision: 0,
      item: habitFromTemplate(HABIT_TEMPLATES[0], day, t),
    },
    1000,
  );
  assert.equal(state.habits.length, 1);
  assert.equal(state.habits[0].title, "text:templateReading");
  assert.ok(State.parse(state).habits[0].rules.length === 1);
});
test("completion modes stay distinct and only daily habits can link the review", () => {
  let state = blankState("synthetic");
  const daily = habitFromTemplate(
    HABIT_TEMPLATES.find((x) => x.id === "dailyReview"),
    day,
    t,
  );
  state = applyAction(
    state,
    { action: "save", collection: "habits", revision: 0, item: daily },
    now,
  );
  const weekly = habitFromTemplate(
    HABIT_TEMPLATES.find((x) => x.id === "weeklyReview"),
    day,
    t,
  );
  weekly.reviewLinked = true;
  state = applyAction(
    state,
    {
      action: "save",
      collection: "habits",
      revision: state.revision,
      item: weekly,
    },
    now,
  );
  assert.equal(state.habits[1].reviewLinked, true);
  const reviewState = applyAction(
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
  assert.equal(
    reviewState.habitLogs.length,
    1,
    "only the daily linked habit is checked",
  );
  assert.equal(reviewState.habitLogs[0].habitId, state.habits[0].id);
});
test("templates no longer carry a time-of-day label", () => {
  for (const template of HABIT_TEMPLATES)
    assert.equal("period" in habitFromTemplate(template, day, t), false);
});
