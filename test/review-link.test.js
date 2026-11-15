import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
const now = Date.parse("2026-11-15T08:00:00Z");
test("saving a daily review does not auto-complete quantity or weekly exercise habits", () => {
  let state = blankState("test");
  const run = (a) =>
    (state = applyAction(state, { revision: state.revision, ...a }, now));
  for (const [title, mode, target] of [
    ["跳绳", "quantity", 1000],
    ["重训", "weekly", 3],
    ["每日复盘", "daily", 1],
  ])
    run({
      action: "save",
      collection: "habits",
      item: {
        title,
        reviewLinked: true,
        rules: [
          {
            effective: "2026-11-01",
            mode,
            target,
            unit: "次",
            days: [0, 1, 2, 3, 4, 5, 6],
          },
        ],
      },
    });
  run({
    action: "review",
    kind: "day",
    date: "2026-11-15",
    text: "今天做得不错",
  });
  assert.equal(state.habitLogs.length, 1);
  assert.equal(state.habitLogs[0].habitId, state.habits[2].id);
});
