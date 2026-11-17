import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction, createService } from "../src/model.js";
import { habitProgress } from "../src/dates.js";
import { pendingPreviousHabits } from "../src/today-view.js";
const date = "2026-11-16";
const at = (s) => Date.parse(s);
function seed(allowNextDay = true) {
  return applyAction(
    blankState("synthetic"),
    {
      action: "save",
      revision: 0,
      collection: "habits",
      item: {
        title: "Review",
        reviewLinked: true,
        rules: [{ effective: date, mode: "daily", allowNextDay }],
      },
    },
    at("2026-11-16T01:00:00Z"),
  );
}
const review = (s, text, now, extra = {}) =>
  applyAction(
    s,
    {
      action: "review",
      revision: s.revision,
      date,
      kind: "day",
      text,
      ...extra,
    },
    now,
  );
test("next-day evening is on time, following midnight is late in workspace timezone", () => {
  let s = seed();
  const end = at("2026-11-17T15:59:59Z");
  s = review(s, "One useful thing", end);
  assert.equal(habitProgress(s, s.habits[0], date, end).status, "onTime");
  assert.equal(s.habitLogs[0].date, date);
  const late = review(seed(), "A late review", at("2026-11-17T16:00:00Z"));
  assert.equal(habitProgress(late, late.habits[0], date).status, "late");
});
test("outside a window means unrecorded, not missed; explicit missed remains distinct", () => {
  let s = seed();
  assert.equal(
    habitProgress(s, s.habits[0], date, at("2026-11-17T12:00:00Z")).status,
    "pending",
  );
  assert.equal(
    habitProgress(s, s.habits[0], date, at("2026-11-18T01:00:00Z")).status,
    "unrecorded",
  );
  s = applyAction(
    s,
    {
      action: "habitLog",
      revision: s.revision,
      id: s.habits[0].id,
      date,
      status: "missed",
    },
    at("2026-11-18T01:00:00Z"),
  );
  assert.equal(habitProgress(s, s.habits[0], date).status, "missed");
  assert.throws(
    () => review(s, "text", at("2026-11-18T01:00:00Z"), { id: s.habits[0].id }),
    /先撤销/,
  );
});
test("only yesterday is offered, with no infinite carryover and no future completion", () => {
  const s = seed();
  const now = at("2026-11-17T12:00:00Z");
  assert.equal(pendingPreviousHabits(s, "2026-11-17", now).length, 1);
  assert.deepEqual(
    pendingPreviousHabits(s, "2026-11-18", at("2026-11-18T01:00:00Z")).map(
      (x) => x.date,
    ),
    ["2026-11-17"],
  );
  assert.throws(
    () =>
      applyAction(
        s,
        {
          action: "review",
          revision: s.revision,
          date: "2026-11-18",
          kind: "day",
          text: "future",
        },
        now,
      ),
    /未来/,
  );
});
test("editing content preserves first completion time and creates no second check-in", () => {
  let s = review(seed(), "First", at("2026-11-16T12:00:00Z"));
  const completedAt = s.reviews[0].completedAt;
  s = review(s, "Edited later", at("2026-11-20T12:00:00Z"), { version: 1 });
  assert.equal(s.reviews[0].completedAt, completedAt);
  assert.equal(s.habitLogs.length, 1);
  assert.equal(habitProgress(s, s.habits[0], date).status, "onTime");
});
test("template questions and blank notes cannot mark a review habit complete", () => {
  const s = seed();
  assert.throws(() => review(s, "  ", at("2026-11-17T01:00:00Z")), /内容/);
  assert.throws(
    () =>
      review(
        s,
        "今天值得记下的事：\n今天的感受或收获：\n接下来想保持或调整的一件事：",
        at("2026-11-17T01:00:00Z"),
      ),
    /内容/,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        {
          action: "habitLog",
          revision: s.revision,
          id: s.habits[0].id,
          date,
          value: 1,
        },
        at("2026-11-17T01:00:00Z"),
      ),
    /复盘内容/,
  );
});
test("review record version protects a draft even with latest global revision", () => {
  const s = review(seed(), "Saved elsewhere", at("2026-11-17T01:00:00Z"));
  assert.throws(
    () => review(s, "Stale draft", at("2026-11-17T02:00:00Z"), { version: 0 }),
    /已被修改/,
  );
});
test("changing next-day rule from today does not recategorize old completions", () => {
  let s = review(seed(false), "Old late review", at("2026-11-17T01:00:00Z"));
  const h = s.habits[0];
  s = applyAction(
    s,
    {
      action: "save",
      revision: s.revision,
      collection: "habits",
      id: h.id,
      item: {
        rules: [
          ...h.rules,
          { ...h.rules[0], effective: "2026-11-17", allowNextDay: true },
        ],
      },
    },
    at("2026-11-17T02:00:00Z"),
  );
  assert.equal(habitProgress(s, s.habits[0], date).status, "late");
});

test("calendar windows handle a daylight-saving day without a fixed 24-hour cutoff", () => {
  let state = blankState("synthetic");
  state.settings.timeZone = "America/New_York";
  state = applyAction(
    state,
    {
      action: "save",
      revision: 0,
      collection: "habits",
      item: {
        title: "Review",
        reviewLinked: true,
        rules: [{ effective: "2026-03-07", mode: "daily", allowNextDay: true }],
      },
    },
    at("2026-03-07T13:00:00Z"),
  );
  const save = (now) =>
    applyAction(
      state,
      {
        action: "review",
        revision: state.revision,
        date: "2026-03-07",
        kind: "day",
        text: "An actual answer",
      },
      now,
    );
  let result = save(at("2026-03-09T03:59:59Z"));
  assert.equal(
    habitProgress(result, result.habits[0], "2026-03-07").status,
    "onTime",
  );
  result = save(at("2026-03-09T04:00:00Z"));
  assert.equal(
    habitProgress(result, result.habits[0], "2026-03-07").status,
    "late",
  );
});
test("template changes do not modify existing answers and reject a stale template editor", () => {
  let s = review(
    seed(),
    "A private synthetic answer",
    at("2026-11-17T01:00:00Z"),
  );
  s = applyAction(
    s,
    {
      action: "settings",
      command: "reviewTemplate",
      text: "",
      revision: s.revision,
      item: { reviewTemplate: "自己的问题？" },
    },
    at("2026-11-17T02:00:00Z"),
  );
  assert.equal(s.reviews[0].text, "A private synthetic answer");
  assert.throws(
    () =>
      applyAction(
        s,
        {
          action: "settings",
          command: "reviewTemplate",
          text: "",
          revision: s.revision,
          item: { reviewTemplate: "旧编辑器" },
        },
        at("2026-11-17T02:00:00Z"),
      ),
    /其他窗口更新/,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        {
          action: "settings",
          revision: s.revision,
          item: { reviewTemplate: Array(9).fill("Q").join("\n") },
        },
        at("2026-11-17T02:00:00Z"),
      ),
    /8/,
  );
});
