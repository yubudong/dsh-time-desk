import test from "node:test";
import assert from "node:assert/strict";
import { blankState, Settings } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { reviewPrompts, normalizeTemplate } from "../src/review-template.js";

const fallback = "值得记下的事\n感受或收获\n想调整的一件事";
const day = "2026-11-16";
const now = Date.parse("2026-11-17T02:00:00Z");

test("a personal template wins over the built-in prompts", () => {
  assert.deepEqual(reviewPrompts("我的问题一\n我的问题二", fallback), [
    "我的问题一",
    "我的问题二",
  ]);
  assert.deepEqual(reviewPrompts("", fallback), [
    "值得记下的事",
    "感受或收获",
    "想调整的一件事",
  ]);
  assert.deepEqual(reviewPrompts("   ", fallback), [
    "值得记下的事",
    "感受或收获",
    "想调整的一件事",
  ]);
});
test("prompt lists are trimmed, deduplicated by line and bounded", () => {
  assert.deepEqual(reviewPrompts("\n 一 \n\n二\n", fallback), ["一", "二"]);
  const many = Array.from({ length: 12 }, (_, i) => "Q" + i).join("\n");
  assert.equal(reviewPrompts(many, fallback).length, 8);
});
test("template editing never stores answers as structure", () => {
  assert.equal(normalizeTemplate("  问题一  \n\n问题二\n"), "问题一\n问题二");
  assert.equal(normalizeTemplate(""), "");
});
test("review template is an optional setting and survives a round trip", () => {
  assert.equal(Settings.parse({}).reviewTemplate, "");
  let state = blankState("synthetic");
  state = applyAction(
    state,
    {
      action: "settings",
      revision: 0,
      item: { reviewTemplate: "问题一\n问题二" },
    },
    now,
  );
  assert.equal(state.settings.reviewTemplate, "问题一\n问题二");
});
test("saving a review for yesterday completes only that day's linked habit", () => {
  let state = blankState("synthetic");
  state.habits.push({
    id: "h-review",
    createdAt: "2026-11-15T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
    version: 1,
    deletedAt: null,
    title: "每日复盘",
    note: "",
    reviewLinked: true,
    plannedDates: [],
    rules: [
      {
        effective: "2026-11-15",
        mode: "daily",
        days: [0, 1, 2, 3, 4, 5, 6],
        target: 1,
        unit: "次",
        paused: false,
      },
    ],
  });
  const saved = applyAction(
    state,
    {
      action: "review",
      revision: 0,
      date: day,
      kind: "day",
      text: "昨天的复盘",
    },
    now,
  );
  assert.equal(saved.reviews.length, 1);
  assert.equal(saved.habitLogs.length, 1);
  assert.equal(saved.habitLogs[0].date, day);
  assert.equal(saved.habitLogs[0].habitId, "h-review");
  assert.equal(saved.habitLogs[0].note, "关联复盘");
});
