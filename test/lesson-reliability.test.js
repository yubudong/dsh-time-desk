import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction, createService, validateState } from "../src/model.js";
import {
  lessonAccount,
  lessonOccurrences,
  lessonReminders,
  lessonStats,
} from "../src/lessons.js";
const NOW = Date.parse("2026-11-17T14:00:00Z");
function setup(item = {}, term) {
  let state = blankState("synthetic-reliability");
  const run = (a, now = NOW) => {
    state = applyAction(state, { revision: state.revision, ...a }, now);
    return state;
  };
  run({
    action: "lesson",
    item: {
      title: "Synthetic lesson",
      participant: "Synthetic attendee",
      effective: "2026-11-01",
      weekdays: [1],
      time: "19:00",
      ...item,
    },
    ...(term ? { term } : {}),
  });
  const id = state.lessons[0].id;
  return {
    run,
    id,
    get state() {
      return state;
    },
    get lesson() {
      return state.lessons[0];
    },
    session(command, extra = {}) {
      return run({
        action: "lessonSession",
        id,
        originalDate: "2026-11-16",
        command,
        ...extra,
      });
    },
  };
}
test("each undo refunds its own latest attendance amount, including after a restore", () => {
  const f = setup({ mode: "credit" });
  f.run({
    action: "lessonCharge",
    id: f.id,
    item: { date: "2026-11-01", kind: "opening", delta: 10 },
  });
  for (const deduction of [1, 2, 0.5, 0, 3]) {
    f.session("complete", { deduction });
    assert.equal(lessonAccount(f.state, f.lesson).balance, 10 - deduction);
    f.session("undo");
    assert.equal(lessonAccount(f.state, f.lesson).balance, 10);
    validateState(f.state);
  }
  const uses = f.state.lessonCharges.filter((x) => x.kind === "use");
  const refunds = f.state.lessonCharges.filter((x) => x.kind === "refund");
  assert.equal(refunds.length, uses.length);
  assert.deepEqual(
    new Set(refunds.map((x) => x.reversesId)),
    new Set(uses.map((x) => x.id)),
  );
});
test("system-generated refund cannot be deleted or forged as an adjustment", () => {
  const f = setup({ mode: "credit" });
  f.session("complete", { confirmShort: true });
  f.session("undo");
  const refund = f.state.lessonCharges.find((x) => x.kind === "refund");
  assert.throws(
    () =>
      f.run({
        action: "lessonCharge",
        command: "remove",
        id: f.id,
        removeId: refund.id,
      }),
    /系统|返还|撤销/,
  );
  assert.throws(
    () =>
      f.run({
        action: "lessonCharge",
        id: f.id,
        item: { date: "2026-11-17", kind: "refund", delta: 1 },
      }),
    /系统|返还|撤销/,
  );
});
test("credit accumulation is exact for six decimal places", () => {
  const f = setup({ mode: "credit" });
  for (const delta of [0.1, 0.2])
    f.run({
      action: "lessonCharge",
      id: f.id,
      item: { date: "2026-11-01", kind: "purchase", delta },
    });
  f.session("complete", { deduction: 0.3 });
  assert.equal(lessonAccount(f.state, f.lesson).balance, 0);
  f.session("undo");
  assert.equal(lessonAccount(f.state, f.lesson).balance, 0.3);
});
test("changing accounting mode with existing history is rejected", () => {
  const f = setup({ mode: "credit" });
  f.session("complete", { confirmShort: true });
  assert.throws(
    () => f.run({ action: "lesson", id: f.id, item: { mode: "none" } }),
    /历史|管理方式/,
  );
});
test("weekday time survives attendance, skip, move and restoring the original schedule", () => {
  const f = setup({
    weekdays: [3, 0],
    weekdayTimes: [{ weekday: 0, time: "10:00" }],
  });
  const at = () =>
    lessonOccurrences(f.state, f.lesson, "2026-11-15", "2026-11-15")[0].time;
  f.session("complete", { originalDate: "2026-11-15" });
  assert.equal(at(), "10:00");
  f.session("undo", { originalDate: "2026-11-15" });
  f.session("skip", { originalDate: "2026-11-15" });
  assert.equal(at(), "10:00");
  f.session("save", {
    originalDate: "2026-11-15",
    date: "2026-11-16",
    time: "13:00",
  });
  f.session("restore", { originalDate: "2026-11-15" });
  assert.equal(at(), "10:00");
});
test("weekday-only reminders work without a default time", () => {
  const f = setup({
    time: "",
    weekdayTimes: [{ weekday: 1, time: "10:00" }],
    reminderMinutes: 15,
  });
  const notices = lessonReminders(
    f.state,
    Date.parse("2026-11-16T01:50:00Z"),
    "Asia/Shanghai",
  );
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /10:00/);
});
test("reminders include tomorrow across midnight and a week ahead with large lead times", () => {
  const a = setup({ weekdays: [2], time: "00:10", reminderMinutes: 30 });
  assert.equal(
    lessonReminders(
      a.state,
      Date.parse("2026-11-16T15:45:00Z"),
      "Asia/Shanghai",
    ).length,
    1,
  );
  const b = setup({ time: "10:00", reminderMinutes: 1440 });
  assert.equal(
    lessonReminders(
      b.state,
      Date.parse("2026-11-15T02:05:00Z"),
      "Asia/Shanghai",
    ).length,
    1,
  );
});
test("moved reminder text uses actual time and invalid DST sessions do not suppress other reminders", () => {
  const f = setup({ reminderMinutes: 15 });
  f.session("save", { date: "2026-11-17", time: "10:00" });
  const n = lessonReminders(
    f.state,
    Date.parse("2026-11-17T01:50:00Z"),
    "Asia/Shanghai",
  );
  assert.equal(n.length, 1);
  assert.match(n[0].title, /10:00/);
  assert.doesNotMatch(n[0].title, /19:00/);
  const d = setup({
    effective: "2026-03-01",
    weekdays: [0],
    time: "02:30",
    reminderMinutes: 30,
  });
  d.run({
    action: "lesson",
    item: {
      title: "Other",
      effective: "2026-03-01",
      weekdays: [0],
      time: "03:30",
      reminderMinutes: 30,
    },
  });
  assert.equal(
    lessonReminders(
      d.state,
      Date.parse("2026-03-08T07:10:00Z"),
      "America/New_York",
    ).length,
    1,
  );
});
test("new one-off course generates one session, with the same identity after moving", () => {
  const f = setup({ weekdays: [], effective: "2026-11-16" });
  assert.equal(
    lessonOccurrences(f.state, f.lesson, "2026-11-01", "2026-12-01").length,
    1,
  );
  f.session("save", { date: "2026-11-17", time: "09:00" });
  const rows = lessonOccurrences(f.state, f.lesson, "2026-11-01", "2026-12-01");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-11-17");
  f.session("complete");
  assert.equal(
    lessonStats(f.state, f.lesson, "2026-11-01", "2026-12-01").sessions,
    1,
  );
});
test("future attendance is blocked and same-course move collisions are detected", () => {
  const f = setup({ weekdays: [1, 3] });
  assert.throws(
    () => f.session("complete", { originalDate: "2026-11-18" }),
    /未来/,
  );
  assert.throws(
    () => f.session("save", { date: "2026-11-18", time: "19:00" }),
    /重叠/,
  );
});
test("editing a term checks only records originally in that term", () => {
  const f = setup({ mode: "term" }, { start: "2026-11-01", end: "2026-11-16" });
  f.session("complete");
  f.run({
    action: "lessonTerm",
    id: f.id,
    command: "renew",
    item: { start: "2026-11-17", end: "2026-12-31" },
  });
  const second = f.state.lessonTerms[1];
  f.run({
    action: "lessonTerm",
    id: f.id,
    command: "save",
    item: { ...second, end: "2026-12-30" },
  });
  assert.equal(f.state.lessonTerms[1].end, "2026-12-30");
});

test("future schedule changes preserve original weekdays, times and moved exceptions", () => {
  const f = setup();
  f.session("save", { date: "2026-11-19", time: "13:00" });
  f.run({
    action: "lesson",
    id: f.id,
    from: "2026-11-18",
    confirm: true,
    item: { weekdays: [3], time: "10:00" },
  });
  const past = lessonOccurrences(f.state, f.lesson, "2026-11-09", "2026-11-09");
  assert.equal(past.length, 1);
  assert.equal(past[0].time, "19:00");
  const next = lessonOccurrences(f.state, f.lesson, "2026-11-18", "2026-11-23");
  assert.deepEqual(
    next.map((x) => [x.originalDate, x.date, x.time]),
    [
      ["2026-11-18", "2026-11-18", "10:00"],
      ["2026-11-16", "2026-11-19", "13:00"],
    ],
  );
  assert.equal(f.lesson.scheduleHistory.length, 2);
  validateState(f.state);
  assert.throws(
    () =>
      f.run({
        action: "lesson",
        id: f.id,
        from: "2026-11-10",
        confirm: true,
        item: { time: "11:00" },
      }),
    /今天|历史/,
  );
  assert.throws(
    () =>
      f.run({
        action: "lesson",
        id: f.id,
        from: "2026-11-19",
        item: { time: "11:00" },
      }),
    /确认/,
  );
});
test("replaying a request cannot refund twice, and pre-upgrade logs remain reversible", () => {
  const f = setup({ mode: "credit" });
  f.session("complete", { confirmShort: true, deduction: 2 });
  const data = structuredClone(f.state);
  for (const row of data.lessonSessions) {
    delete row.chargeId;
    delete row.changes;
  }
  for (const row of data.lessonCharges) delete row.reversesId;
  const parsed = validateState(data);
  const a = {
    action: "lessonSession",
    id: f.id,
    originalDate: "2026-11-16",
    command: "undo",
    requestId: "synthetic-undo",
    revision: parsed.revision,
  };
  const once = applyAction(parsed, a, NOW),
    twice = applyAction(once, a, NOW);
  assert.equal(once.revision, twice.revision);
  assert.equal(
    twice.lessonCharges.filter((x) => x.kind === "refund").length,
    1,
  );
  assert.equal(lessonAccount(twice, twice.lessons[0]).balance, 0);
});
test("paid absence is audited and reversible without counting as attendance", () => {
  const f = setup({ mode: "credit" });
  f.session("skip", {
    deduction: 1,
    confirmShort: true,
    note: "机构规则扣一次",
  });
  assert.equal(lessonAccount(f.state, f.lesson).balance, -1);
  assert.equal(
    lessonStats(f.state, f.lesson, "2026-11-01", "2026-11-17").sessions,
    0,
  );
  f.session("undo");
  assert.equal(lessonAccount(f.state, f.lesson).balance, 0);
});
