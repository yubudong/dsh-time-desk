import test from "node:test";
import assert from "node:assert/strict";
import { blankState, State, LessonInput } from "../src/schema.js";
import {
  lessonOccurrences,
  lessonAccount,
  lessonStats,
  lessonConflict,
  lessonExpiring,
  lessonReminders,
  lessonTermAt,
  lessonWeeklyLabel,
} from "../src/lessons.js";
import { shift } from "../src/dates.js";
const iso = "2026-11-01T00:00:00.000Z";
const meta = (id) => ({
  id,
  createdAt: iso,
  updatedAt: iso,
  version: 1,
  deletedAt: null,
});
function base() {
  return blankState("synthetic");
}
function addLesson(s, patch = {}) {
  const lesson = {
    ...meta("lesson-piano"),
    title: "钢琴",
    participant: "孩子",
    place: "琴行",
    note: "",
    mode: "none",
    weekdays: [1],
    time: "16:30",
    durationMinutes: 60,
    effective: "2026-11-02",
    until: "",
    reminderMinutes: null,
    defaultDeduction: 1,
    balanceWarnAt: null,
    ...patch,
  };
  s.lessons.push(lesson);
  return lesson;
}
function addRow(s, collection, patch) {
  const row = { ...meta(collection + "-" + s[collection].length), ...patch };
  s[collection].push(row);
  return row;
}
const byDate = (list, date) => list.filter((x) => x.date === date);
test("weekly lessons generate only selected weekdays inside the effective range", () => {
  const s = base();
  const l = addLesson(s, {
    weekdays: [1, 3],
    effective: "2026-11-09",
    until: "2026-11-20",
  });
  const list = lessonOccurrences(s, l, "2026-11-01", "2026-11-30");
  assert.deepEqual(
    list.map((x) => x.date),
    ["2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18"],
  );
  assert.equal(list[0].time, "16:30");
  assert.equal(list[0].status, "scheduled");
});
test("one moved session replaces its original date and never creates a second obligation", () => {
  const s = base();
  const l = addLesson(s);
  addRow(s, "lessonSessions", {
    lessonId: l.id,
    originalDate: "2026-11-16",
    date: "2026-11-18",
    time: "19:00",
    place: "新场地",
    status: "scheduled",
    extra: false,
  });
  const list = lessonOccurrences(s, l, "2026-11-15", "2026-11-22");
  assert.equal(list.length, 1);
  assert.equal(byDate(list, "2026-11-16").length, 0);
  const moved = byDate(list, "2026-11-18")[0];
  assert.equal(moved.time, "19:00");
  assert.equal(moved.movedFrom, "2026-11-16");
  assert.equal(moved.key, l.id + "@2026-11-16");
});
test("restoring the original date keeps one session and extra sessions appear once", () => {
  const s = base();
  const l = addLesson(s, { weekdays: [] });
  addRow(s, "lessonSessions", {
    lessonId: l.id,
    originalDate: "",
    date: "2026-11-20",
    time: "10:00",
    status: "scheduled",
    extra: true,
  });
  const list = lessonOccurrences(s, l, "2026-11-20", "2026-11-20");
  assert.equal(list.length, 1);
  assert.equal(list[0].extra, true);
  const restored = addLesson(s, { id: "lesson-restored", weekdays: [1] });
  addRow(s, "lessonSessions", {
    lessonId: restored.id,
    originalDate: "2026-11-16",
    date: "2026-11-16",
    time: "16:30",
    status: "scheduled",
  });
  assert.equal(
    lessonOccurrences(s, restored, "2026-11-16", "2026-11-16").length,
    1,
  );
});
test("term lessons stop at the term end and keep only completed sessions in that period", () => {
  const s = base();
  const l = addLesson(s, {
    mode: "term",
    effective: "2026-09-01",
    weekdays: [1],
  });
  addRow(s, "lessonTerms", {
    lessonId: l.id,
    start: "2026-09-01",
    end: "2026-11-30",
    purchased: 20,
    amount: 2000,
    note: "",
  });
  assert.equal(lessonOccurrences(s, l, "2026-11-23", "2026-11-30").length, 2);
  assert.equal(lessonOccurrences(s, l, "2026-12-01", "2026-12-31").length, 0);
  addRow(s, "lessonSessions", {
    lessonId: l.id,
    originalDate: "2026-11-23",
    date: "2026-11-23",
    time: "16:30",
    status: "done",
    completedAt: iso,
    deduction: 2,
  });
  const stats = lessonStats(s, l, "2026-09-01", "2026-11-30");
  assert.equal(stats.sessions, 1);
  assert.equal(stats.units, 2);
  assert.ok(lessonTermAt(l, s.lessonTerms, "2026-11-23"));
  assert.equal(lessonTermAt(l, s.lessonTerms, "2026-12-01"), null);
});
test("renewing a term keeps the previous period's history separate", () => {
  const s = base();
  const l = addLesson(s, {
    mode: "term",
    effective: "2026-09-01",
    weekdays: [1],
  });
  addRow(s, "lessonTerms", {
    lessonId: l.id,
    start: "2026-09-01",
    end: "2026-11-30",
    purchased: 10,
    amount: 1000,
    note: "",
  });
  addRow(s, "lessonTerms", {
    lessonId: l.id,
    start: "2026-12-01",
    end: "2027-02-28",
    purchased: 10,
    amount: 1000,
    note: "",
  });
  addRow(s, "lessonSessions", {
    lessonId: l.id,
    originalDate: "2026-11-30",
    date: "2026-11-30",
    time: "16:30",
    status: "done",
    deduction: 1,
  });
  const first = lessonStats(s, l, "2026-09-01", "2026-11-30");
  const second = lessonStats(s, l, "2026-12-01", "2027-02-28");
  assert.equal(first.sessions, 1);
  assert.equal(second.sessions, 0);
});
test("credit account sums purchases, gifts, opening balance, use and refunds", () => {
  const s = base();
  const l = addLesson(s, { mode: "credit" });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-01",
    delta: 10,
    kind: "purchase",
    amount: 1000,
    note: "",
  });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-01",
    delta: 2,
    kind: "gift",
    amount: null,
    note: "",
  });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-10",
    delta: -1,
    kind: "use",
    note: "",
  });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-12",
    delta: -1,
    kind: "use",
    note: "",
  });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-13",
    delta: 1,
    kind: "refund",
    note: "",
  });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-14",
    delta: -0.5,
    kind: "adjust",
    note: "",
  });
  const account = lessonAccount(s, l);
  assert.equal(account.purchased, 10);
  assert.equal(account.gifted, 2);
  assert.equal(account.used, 2);
  assert.equal(account.refunded, 1);
  assert.equal(account.adjusted, -0.5);
  assert.equal(account.balance, 10.5);
});
test("an opening balance works without backfilling history and may go negative", () => {
  const s = base();
  const l = addLesson(s, { mode: "credit" });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-01",
    delta: 8,
    kind: "opening",
    note: "现有余额",
  });
  addRow(s, "lessonCharges", {
    lessonId: l.id,
    date: "2026-11-02",
    delta: -9,
    kind: "use",
    note: "",
  });
  assert.equal(lessonAccount(s, l).balance, -1);
});
test("conflicts compare only the same participant and allow skipping the moved session", () => {
  const s = base();
  const a = addLesson(s, {
    id: "a",
    title: "围棋",
    participant: "孩子",
    weekdays: [3],
    time: "18:00",
  });
  const b = addLesson(s, {
    id: "b",
    title: "英语",
    participant: "孩子",
    weekdays: [3],
    time: "19:00",
  });
  const c = addLesson(s, {
    id: "c",
    title: "瑜伽",
    participant: "我",
    weekdays: [3],
    time: "18:30",
  });
  assert.equal(
    lessonConflict(s, a, "2026-11-18", "18:30", 60, "a@2026-11-18").length,
    1,
  );
  assert.equal(
    lessonConflict(s, a, "2026-11-18", "18:30", 60, "a@2026-11-18")[0].title,
    "英语",
  );
  assert.equal(lessonConflict(s, a, "2026-11-18", "20:30", 60).length, 0);
  assert.equal(
    lessonConflict(s, c, "2026-11-18", "18:30", 60, "c@2026-11-18").length,
    0,
  );
});
test("expiry warnings cover term ends and credit purchases with expiry", () => {
  const s = base();
  const term = addLesson(s, {
    id: "term",
    mode: "term",
    weekdays: [1],
    effective: "2026-09-01",
  });
  addRow(s, "lessonTerms", {
    lessonId: term.id,
    start: "2026-09-01",
    end: "2026-12-10",
    purchased: 20,
    amount: 2000,
    note: "",
  });
  const credit = addLesson(s, {
    id: "credit",
    mode: "credit",
    balanceWarnAt: 2,
  });
  addRow(s, "lessonCharges", {
    lessonId: credit.id,
    date: "2026-11-01",
    delta: 10,
    kind: "purchase",
    amount: 1000,
    note: "",
    expiresOn: "2026-12-05",
  });
  const warnings = lessonExpiring(s, "2026-11-17");
  assert.deepEqual(
    warnings.map((x) => x.kind),
    ["credit-expiry", "term"],
  );
  assert.equal(warnings[0].days, 18);
  assert.equal(warnings[1].days, 23);
});
test("lesson reminders fire within the window and stay suppressible by a stable key", () => {
  const s = base();
  const l = addLesson(s, { weekdays: [1], time: "16:30", reminderMinutes: 30 });
  const now = Date.parse("2026-11-16T08:10:00Z"); // 16:10 in Asia/Shanghai
  const list = lessonReminders(s, now, "Asia/Shanghai");
  assert.equal(list.length, 1);
  assert.equal(list[0].date, "2026-11-16");
  assert.match(list[0].key, /lesson:/);
  assert.equal(
    lessonReminders(s, Date.parse("2026-11-16T07:00:00Z"), "Asia/Shanghai")
      .length,
    0,
  );
});
test("legacy state defaults the new collections and home layout", () => {
  const legacy = blankState("legacy");
  const parsed = State.parse({
    ...legacy,
    settings: { timeZone: "Asia/Shanghai" },
  });
  assert.deepEqual(parsed.lessons, []);
  assert.deepEqual(parsed.lessonTerms, []);
  assert.deepEqual(parsed.settings.homeModules, {
    hidden: [],
    order: [],
    folded: [],
  });
});

test("weekdays can carry different start times", () => {
  const s = base();
  const l = addLesson(s, {
    weekdays: [3, 0],
    time: "19:00",
    weekdayTimes: [{ weekday: 0, time: "10:00" }],
  });
  const list = lessonOccurrences(s, l, "2026-11-16", "2026-11-22");
  assert.equal(byDate(list, "2026-11-18")[0].time, "19:00");
  assert.equal(byDate(list, "2026-11-22")[0].time, "10:00");
  const t = (k) =>
    ({
      weekdayShort3: "周三",
      weekdayShort0: "周日",
      lessonOnce: "单次",
    })[k] || k;
  assert.equal(lessonWeeklyLabel(l, t), "周三 19:00 · 周日 10:00");
});
test("a per-weekday time must belong to a selected weekday", () => {
  assert.throws(
    () =>
      LessonInput.parse({
        title: "x",
        effective: "2026-11-01",
        weekdays: [3],
        weekdayTimes: [{ weekday: 0, time: "10:00" }],
      }),
    /分星期/,
  );
});
