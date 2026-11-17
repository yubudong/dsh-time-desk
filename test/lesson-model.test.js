import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction, validateState } from "../src/model.js";
import {
  lessonAccount,
  lessonOccurrences,
  lessonStats,
  lessonTerms,
} from "../src/lessons.js";
const NOW = Date.parse("2026-11-17T02:00:00Z");
function harness() {
  let s = blankState("lesson-device");
  return {
    get state() {
      return s;
    },
    do(a, now = NOW) {
      s = applyAction(s, { revision: s.revision, ...a }, now);
      return s;
    },
    lesson(item = {}, term) {
      this.do({
        action: "lesson",
        item: {
          title: "钢琴",
          participant: "孩子",
          weekdays: [1],
          time: "16:30",
          durationMinutes: 60,
          effective: "2026-11-02",
          ...item,
        },
        ...(term ? { term } : {}),
      });
      return s.lessons.at(-1);
    },
  };
}
test("a term course requires a validity period and stores it atomically", () => {
  const h = harness();
  assert.throws(() => h.lesson({ mode: "term" }), /有效期/);
  const l = h.lesson(
    { mode: "term", effective: "2026-09-01" },
    { start: "2026-09-01", end: "2026-11-30", purchased: 20, amount: 2000 },
  );
  const terms = lessonTerms(h.state, l.id);
  assert.equal(terms.length, 1);
  assert.equal(terms[0].end, "2026-11-30");
  assert.equal(terms[0].amount, 2000);
});
test("credit lessons deduct on confirmed attendance, block duplicates and refund on undo", () => {
  const h = harness();
  const l = h.lesson({ mode: "credit" });
  h.do({
    action: "lessonCharge",
    id: l.id,
    item: { date: "2026-11-01", delta: 8, kind: "opening", note: "现有余额" },
  });
  assert.equal(lessonAccount(h.state, l).balance, 8);
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
    deduction: 1,
  });
  assert.equal(lessonAccount(h.state, l).balance, 7);
  const row = h.state.lessonSessions.find((x) => x.lessonId === l.id);
  assert.equal(row.status, "done");
  assert.ok(row.completedAt);
  assert.throws(
    () =>
      h.do({
        action: "lessonSession",
        command: "complete",
        id: l.id,
        originalDate: "2026-11-16",
      }),
    /已经记录/,
  );
  h.do({
    action: "lessonSession",
    command: "undo",
    id: l.id,
    sessionId: row.id,
  });
  assert.equal(lessonAccount(h.state, l).balance, 8);
  assert.equal(
    h.state.lessonCharges.filter((x) => !x.deletedAt && x.kind === "refund")
      .length,
    1,
  );
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
    deduction: 1,
  });
  assert.equal(lessonAccount(h.state, l).balance, 7);
});
test("insufficient credit needs explicit confirmation and may end negative", () => {
  const h = harness();
  const l = h.lesson({ mode: "credit" });
  h.do({
    action: "lessonCharge",
    id: l.id,
    item: { date: "2026-11-01", delta: 1, kind: "opening" },
  });
  assert.throws(
    () =>
      h.do({
        action: "lessonSession",
        command: "complete",
        id: l.id,
        originalDate: "2026-11-16",
        deduction: 2,
      }),
    /课时不足/,
  );
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
    deduction: 2,
    confirmShort: true,
  });
  assert.equal(lessonAccount(h.state, l).balance, -1);
});
test("one session can move, be restored and skipped without duplicating the obligation", () => {
  const h = harness();
  const l = h.lesson();
  h.do({
    action: "lessonSession",
    command: "save",
    id: l.id,
    originalDate: "2026-11-16",
    date: "2026-11-18",
    time: "19:00",
    place: "新教室",
  });
  let list = lessonOccurrences(h.state, l, "2026-11-16", "2026-11-18");
  assert.equal(list.length, 1);
  assert.equal(list[0].date, "2026-11-18");
  assert.equal(list[0].movedFrom, "2026-11-16");
  h.do({
    action: "lessonSession",
    command: "restore",
    id: l.id,
    originalDate: "2026-11-16",
  });
  list = lessonOccurrences(h.state, l, "2026-11-16", "2026-11-18");
  assert.equal(list.length, 1);
  assert.equal(list[0].date, "2026-11-16");
  h.do({
    action: "lessonSession",
    command: "skip",
    id: l.id,
    originalDate: "2026-11-16",
  });
  assert.equal(
    lessonOccurrences(h.state, l, "2026-11-16", "2026-11-16")[0].status,
    "skipped",
  );
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
  });
  assert.equal(
    lessonOccurrences(h.state, l, "2026-11-16", "2026-11-16")[0].status,
    "done",
  );
});
test("rescheduling warns about an overlap and honors confirmation", () => {
  const h = harness();
  const a = h.lesson({ title: "围棋", time: "18:00", weekdays: [1] });
  h.lesson({ title: "英语", time: "19:00", weekdays: [3] });
  assert.throws(
    () =>
      h.do({
        action: "lessonSession",
        command: "save",
        id: a.id,
        originalDate: "2026-11-16",
        date: "2026-11-18",
        time: "19:30",
      }),
    /时间重叠/,
  );
  h.do({
    action: "lessonSession",
    command: "save",
    id: a.id,
    originalDate: "2026-11-16",
    date: "2026-11-18",
    time: "19:30",
    confirmConflict: true,
  });
  assert.equal(
    lessonOccurrences(h.state, a, "2026-11-18", "2026-11-18").length,
    1,
  );
});
test("term lessons stop outside validity, renew into a new period and keep old stats", () => {
  const h = harness();
  const l = h.lesson(
    { mode: "term", weekdays: [1], effective: "2026-11-16" },
    { start: "2026-11-16", end: "2026-11-30", purchased: 4 },
  );
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
    deduction: 1,
  });
  assert.equal(lessonStats(h.state, l, "2026-11-16", "2026-11-30").sessions, 1);
  assert.throws(
    () =>
      h.do({
        action: "lessonSession",
        command: "complete",
        id: l.id,
        originalDate: "2026-12-07",
      }),
    /有效期/,
  );
  h.do({
    action: "lessonTerm",
    command: "renew",
    id: l.id,
    item: { end: "2027-02-28", purchased: 10, amount: 1000 },
  });
  const terms = lessonTerms(h.state, l.id);
  assert.equal(terms.length, 2);
  assert.equal(terms[1].start, "2026-12-01");
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-12-07",
    deduction: 1,
  });
  assert.equal(lessonStats(h.state, l, "2026-12-01", "2027-02-28").sessions, 1);
  assert.equal(lessonStats(h.state, l, "2026-11-16", "2026-11-30").sessions, 1);
});
test("a validity period cannot be shrunk past a completed lesson", () => {
  const h = harness();
  const l = h.lesson(
    { mode: "term", weekdays: [1], effective: "2026-11-16" },
    { start: "2026-11-16", end: "2026-11-30", purchased: 4 },
  );
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-23",
    deduction: 1,
  });
  const term = lessonTerms(h.state, l.id)[0];
  assert.throws(
    () =>
      h.do({
        action: "lessonTerm",
        id: l.id,
        item: {
          id: term.id,
          start: term.start,
          end: "2026-11-20",
          purchased: 4,
        },
      }),
    /已上课/,
  );
});
test("charges can be corrected but usage is only reversed through attendance undo", () => {
  const h = harness();
  const l = h.lesson({ mode: "credit" });
  h.do({
    action: "lessonCharge",
    id: l.id,
    item: { date: "2026-11-01", delta: 5, kind: "purchase", amount: 500 },
  });
  const purchase = h.state.lessonCharges[0];
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
    deduction: 1,
  });
  const use = h.state.lessonCharges.find((x) => x.kind === "use");
  assert.throws(
    () =>
      h.do({
        action: "lessonCharge",
        command: "remove",
        id: l.id,
        removeId: use.id,
      }),
    /撤销上课/,
  );
  h.do({
    action: "lessonCharge",
    command: "remove",
    id: l.id,
    removeId: purchase.id,
  });
  assert.equal(lessonAccount(h.state, l).balance, -1);
});
test("lesson editing is protected by its record version", () => {
  const h = harness();
  const l = h.lesson();
  assert.throws(
    () =>
      h.do({
        action: "lesson",
        id: l.id,
        version: 0,
        item: { ...l, title: "改期" },
      }),
    /已被修改/,
  );
  h.do({
    action: "lesson",
    id: l.id,
    version: l.version,
    item: { ...l, title: "钢琴进阶" },
  });
  assert.equal(h.state.lessons[0].title, "钢琴进阶");
});
test("lesson trash keeps history and backup validation accepts the new collections", () => {
  const h = harness();
  const l = h.lesson({ mode: "credit" });
  h.do({
    action: "lessonCharge",
    id: l.id,
    item: { date: "2026-11-01", delta: 3, kind: "opening" },
  });
  h.do({
    action: "lessonSession",
    command: "complete",
    id: l.id,
    originalDate: "2026-11-16",
  });
  h.do({ action: "trash", collection: "lessons", id: l.id });
  assert.equal(h.state.lessons[0].deletedAt !== null, true);
  assert.equal(h.state.lessonCharges.filter((x) => !x.deletedAt).length, 2);
  h.do({ action: "restore", collection: "lessons", id: l.id });
  assert.equal(validateState(h.state).lessons.length, 1);
});
