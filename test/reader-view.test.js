import test from "node:test";
import assert from "node:assert/strict";
import { readerView } from "../src/reader-view.js";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import { focusView } from "../src/focus-state.js";
const NOW = Date.parse("2026-11-15T06:15:00Z");

test("ordinary clock replaces a 44-minute countdown with wall time", () => {
  const value = readerView("clock", NOW, "Asia/Shanghai", "44:00", 44 / 45);
  assert.equal(value.display, "14:15:00");
  assert.equal(value.showFocus, false);
  assert.equal(value.isClock, true);
});
test("clock mode advances by seconds, independently of the countdown", () => {
  assert.equal(
    readerView("clock", NOW + 1000, "Asia/Shanghai", "43:59", 0.9).display,
    "14:15:01",
  );
  assert.equal(
    readerView("clock", NOW + 61000, "Asia/Shanghai", "42:59", 0.9).display,
    "14:16:01",
  );
});
test("switching back restores the current countdown rather than the wall clock", () => {
  assert.equal(
    readerView("clock", NOW, "Asia/Shanghai", "44:00", 0.9).display,
    "14:15:00",
  );
  const value = readerView("focus", NOW + 2000, "Asia/Shanghai", "43:58", 0.8);
  assert.equal(value.display, "43:58");
  assert.equal(value.ratio, 0.8);
  assert.equal(value.showFocus, true);
});
test("ordinary clock follows the workspace timezone and handles midnight", () => {
  assert.equal(readerView("clock", NOW, "UTC", "44:00", 1).display, "06:15:00");
  assert.equal(
    readerView(
      "clock",
      Date.parse("2026-11-15T16:00:00Z"),
      "Asia/Shanghai",
      "44:00",
      1,
    ).display,
    "00:00:00",
  );
});
test("mode switching leaves a running timer and its records unchanged", () => {
  let state = blankState("test");
  state = applyAction(
    state,
    { action: "timer", command: "start", revision: 0, item: { minutes: 45 } },
    NOW - 60000,
  );
  const before = structuredClone(state);
  for (const mode of ["clock", "focus", "clock", "focus"]) {
    const focus = focusView(state.timer, state.settings, NOW + 5000);
    readerView(
      mode,
      NOW + 5000,
      state.settings.timeZone,
      focus.display,
      focus.ratio,
    );
  }
  assert.deepEqual(state, before);
  assert.equal(state.timer.duration, 2700);
  assert.equal(state.focusLogs.length, 0);
});
test("ordinary clock works without an active focus session", () => {
  const state = blankState("test");
  const focus = focusView(null, state.settings, NOW);
  const view = readerView(
    "clock",
    NOW,
    state.settings.timeZone,
    focus.display,
    focus.ratio,
  );
  assert.equal(view.display, "14:15:00");
  assert.equal(view.showFocus, false);
  assert.equal(state.timer, null);
  assert.equal(state.focusLogs.length, 0);
});
