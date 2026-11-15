import test from "node:test";
import assert from "node:assert/strict";
import { blankState, State } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import {
  durationSeconds,
  focusView,
  formatCountdown,
  prepareTimerStart,
} from "../src/focus-state.js";
const NOW = Date.parse("2026-11-15T04:00:00Z");
function fixture() {
  let state = blankState("test");
  return {
    get state() {
      return state;
    },
    act(a, now = NOW) {
      state = applyAction(state, { revision: state.revision, ...a }, now);
      return state;
    },
  };
}

test("old data receives display preferences without changing timer or records", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start" });
  const old = structuredClone(f.state);
  delete old.settings.timerFace;
  delete old.settings.displayBrightness;
  delete old.settings.reduceMotion;
  const next = State.parse(old);
  assert.equal(next.settings.timerFace, "digital");
  assert.equal(next.settings.displayBrightness, 90);
  assert.equal(next.settings.reduceMotion, false);
  assert.deepEqual(next.timer, old.timer);
  assert.equal(next.revision, old.revision);
});
test("one-time duration changes only the newly started focus round", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start", item: { minutes: 10 } });
  assert.equal(f.state.timer.duration, 600);
  assert.equal(f.state.settings.focusMinutes, 25);
  f.act(
    { action: "timer", command: "finish", timerId: f.state.timer.id },
    NOW + 600000,
  );
  assert.equal(f.state.focusLogs[0].completed, true);
  assert.equal(f.state.focusLogs[0].seconds, 600);
  f.act({ action: "timer", command: "start" }, NOW + 700000);
  assert.equal(f.state.timer.duration, 1500);
});
test("changing default while running preserves id deadline duration and elapsed", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start", item: { minutes: 15 } });
  const original = structuredClone(f.state.timer);
  f.act({ action: "settings", item: { focusMinutes: 45 } }, NOW + 100000);
  assert.deepEqual(f.state.timer, original);
  assert.equal(f.state.settings.focusMinutes, 45);
  f.act({ action: "timer", command: "discard", timerId: original.id });
  f.act({ action: "timer", command: "start" });
  assert.equal(f.state.timer.duration, 2700);
});
test("all face and brightness changes are presentation-only for an active timer", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start" });
  const original = structuredClone(f.state.timer);
  for (const timerFace of ["digital", "ring", "flip", "hourglass"]) {
    f.act({
      action: "settings",
      item: { timerFace, displayBrightness: 70, reduceMotion: true },
    });
    assert.deepEqual(f.state.timer, original);
  }
  assert.equal(f.state.focusLogs.length, 0);
});
test("duration boundaries and phase ownership reject unsupported overrides", () => {
  for (const n of [0, -1, 181, 2.5, "25", NaN])
    assert.throws(() => durationSeconds({ focusMinutes: 25 }, "focus", n));
  assert.equal(durationSeconds({}, "focus", 1), 60);
  assert.equal(durationSeconds({}, "focus", 180), 10800);
  assert.throws(() => durationSeconds({ shortBreak: 5 }, "short", 10));
  const f = fixture();
  assert.throws(() =>
    f.act({ action: "timer", command: "start", item: { minutes: 0 } }),
  );
  assert.equal(f.state.timer, null);
});
test("a once-only UI selection applies to task starts but not break starts or explicit durations", () => {
  const task = {
    action: "timer",
    command: "start",
    taskId: "task",
    originalDate: "2026-11-15",
  };
  const enriched = prepareTimerStart(task, 15);
  assert.equal(enriched.item.minutes, 15);
  assert.equal(task.item, undefined);
  assert.equal(enriched.taskId, "task");
  assert.equal(prepareTimerStart(task, null), task);
  const rest = { action: "timer", command: "start", phase: "long" };
  assert.equal(prepareTimerStart(rest, 15), rest);
  const explicit = { ...task, item: { minutes: 45 } };
  assert.equal(prepareTimerStart(explicit, 15), explicit);
});
test("state labels distinguish ready running paused resting and finished", () => {
  const f = fixture();
  assert.equal(focusView(null, f.state.settings, NOW, 10).display, "10:00");
  assert.equal(focusView(null, f.state.settings, NOW, null).state, "ready");
  f.act({ action: "timer", command: "start" });
  assert.equal(
    focusView(f.state.timer, f.state.settings, NOW + 60000, null).display,
    "24:00",
  );
  assert.equal(
    focusView(f.state.timer, f.state.settings, NOW + 60000, null).state,
    "running",
  );
  f.act(
    { action: "timer", command: "pause", timerId: f.state.timer.id },
    NOW + 60000,
  );
  assert.equal(
    focusView(f.state.timer, f.state.settings, NOW + 999000, null).state,
    "paused",
  );
  assert.equal(
    focusView(f.state.timer, f.state.settings, NOW + 999000, null).remaining,
    1440,
  );
  f.act({ action: "timer", command: "discard", timerId: f.state.timer.id });
  f.act({ action: "timer", command: "start", phase: "short" });
  assert.equal(
    focusView(f.state.timer, f.state.settings, NOW + 10000, null).state,
    "resting",
  );
  assert.equal(
    focusView(f.state.timer, f.state.settings, NOW + 300000, null).state,
    "finished",
  );
});
test("expired rounds stay at zero and never create extra logs or automatic rounds", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start" });
  const before = structuredClone(f.state);
  const view = focusView(
    f.state.timer,
    f.state.settings,
    NOW + 10 * 3600000,
    10,
  );
  assert.equal(view.remaining, 0);
  assert.equal(view.elapsed, 1500);
  assert.equal(view.display, "00:00");
  assert.equal(view.state, "finished");
  assert.deepEqual(f.state, before);
});
test("presentation can be read repeatedly without advancing records", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start" });
  const original = structuredClone(f.state);
  for (let n = 0; n < 60; n++)
    focusView(f.state.timer, f.state.settings, NOW + n * 1000, 45);
  assert.deepEqual(f.state, original);
});
test("custom round duration is preserved through pause resume and restore validation", () => {
  const f = fixture();
  f.act({ action: "timer", command: "start", item: { minutes: 45 } });
  f.act(
    { action: "timer", command: "pause", timerId: f.state.timer.id },
    NOW + 120000,
  );
  const restored = State.parse(structuredClone(f.state));
  assert.equal(restored.timer.duration, 2700);
  assert.equal(
    focusView(restored.timer, restored.settings, NOW + 900000).display,
    "43:00",
  );
  f.act(
    { action: "timer", command: "resume", timerId: f.state.timer.id },
    NOW + 900000,
  );
  assert.equal(f.state.timer.deadline, NOW + 900000 + 2580000);
});
test("countdown formatting never becomes negative and supports long sessions", () => {
  assert.equal(formatCountdown(-2), "00:00");
  assert.equal(formatCountdown(0.1), "00:01");
  assert.equal(formatCountdown(10800), "180:00");
});
test("invalid face names and brightness ranges cannot corrupt saved settings", () => {
  const f = fixture();
  assert.throws(() =>
    f.act({ action: "settings", item: { timerFace: "unknown" } }),
  );
  assert.throws(() =>
    f.act({ action: "settings", item: { displayBrightness: 0 } }),
  );
  assert.throws(() =>
    f.act({ action: "settings", item: { displayBrightness: 101 } }),
  );
  assert.equal(f.state.revision, 0);
});
