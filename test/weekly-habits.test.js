import test from "node:test";
import assert from "node:assert/strict";
import { blankState, HabitRule, State } from "../src/schema.js";
import { applyAction, createService } from "../src/model.js";
import { habitRestInfo, weeklyHabitStatus } from "../src/weekly-habits.js";
const at = (date) => Date.parse(date + "T04:00:00Z");
function fixture(day = "2026-11-20", rest = 1, target = 3) {
  let s = blankState("synthetic-weekly");
  s = applyAction(
    s,
    {
      action: "save",
      revision: 0,
      collection: "habits",
      item: {
        title: "Synthetic weekly",
        rules: [
          { effective: "2026-11-01", mode: "weekly", restDays: rest, target },
        ],
      },
    },
    at(day),
  );
  const id = s.habits[0].id;
  return {
    get state() {
      return s;
    },
    get habit() {
      return s.habits[0];
    },
    id,
    run(a, when = day) {
      s = applyAction(s, { revision: s.revision, ...a }, at(when));
      return s;
    },
    done(date) {
      s = applyAction(
        s,
        {
          action: "habitLog",
          revision: s.revision,
          id,
          date,
          value: 1,
          confirmRest: true,
        },
        at(day),
      );
    },
    status(date = day) {
      return weeklyHabitStatus(s, s.habits[0], date, at(day));
    },
  };
}
test("Friday with no training has two feasible dates rather than three consecutive days", () => {
  const f = fixture();
  const p = f.status();
  assert.equal(p.completed, 0);
  assert.equal(p.remaining, 3);
  assert.equal(p.capacity, 2);
  assert.equal(p.risk, "short");
  assert.deepEqual(p.suggested, ["2026-11-20", "2026-11-22"]);
});
test("training on Thursday leaves Friday as rest and only Saturday feasible this week", () => {
  const f = fixture();
  f.done("2026-11-19");
  const p = f.status();
  assert.equal(p.completed, 1);
  assert.equal(p.remaining, 2);
  assert.equal(p.capacity, 1);
  assert.equal(p.restToday, true);
  assert.deepEqual(p.suggested, ["2026-11-21"]);
});
test("Wednesday has exactly enough spaced dates and prompts earlier than a simple three-day countdown", () => {
  const f = fixture("2026-11-18");
  const p = f.status();
  assert.equal(p.risk, "tight");
  assert.equal(p.capacity, 3);
  assert.deepEqual(p.suggested, ["2026-11-18", "2026-11-20", "2026-11-22"]);
});
test("rest extends across the Monday week boundary without carrying unmet goals", () => {
  const f = fixture("2026-11-23");
  f.done("2026-11-22");
  const p = f.status();
  assert.equal(p.completed, 0);
  assert.equal(p.remaining, 3);
  assert.equal(p.restToday, true);
  assert.equal(p.nextEligible, "2026-11-24");
  assert.equal(p.from, "2026-11-23");
});
test("today is not a second remaining opportunity after training, and a completed goal has no warning", () => {
  const f = fixture("2026-11-20", 1, 1);
  f.done("2026-11-20");
  const p = f.status();
  assert.equal(p.todayDone, true);
  assert.equal(p.remaining, 0);
  assert.equal(p.risk, "complete");
  assert.equal(p.showWarning, false);
  assert.equal(p.availableDates.includes("2026-11-20"), false);
  assert.deepEqual(p.suggested, []);
});
test("plans are not attendance, preserve compatible preferences, and do not turn an uncompleted yesterday into training", () => {
  const f = fixture("2026-11-18", 1, 2);
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-17",
    status: "planned",
  });
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-20",
    status: "planned",
  });
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-22",
    status: "planned",
  });
  const p = f.status();
  assert.equal(p.completed, 0);
  assert.deepEqual(p.suggested, ["2026-11-20", "2026-11-22"]);
  assert.equal(
    habitRestInfo(f.state, f.habit, "2026-11-18", at("2026-11-18"), true)
      .violation,
    false,
  );
});
test("explicit skip or missed days are unavailable; ordinary rest days never generate missed records", () => {
  const f = fixture();
  f.run({ action: "habitLog", id: f.id, date: "2026-11-20", skipped: true });
  const p = f.status();
  assert.deepEqual(p.suggested, ["2026-11-21"]);
  assert.equal(p.capacity, 1);
  assert.equal(f.state.habitLogs.length, 1);
  assert.equal(f.state.habitLogs[0].missed, false);
});
test("historical and future pages do not show an active warning; optional hints can be disabled", () => {
  const f = fixture();
  assert.equal(f.status("2026-11-13").showHints, false);
  assert.equal(f.status("2026-11-23").showWarning, false);
  const s = structuredClone(f.state);
  s.habits[0].rules[0].weeklyHints = false;
  const p = weeklyHabitStatus(s, s.habits[0], "2026-11-20", at("2026-11-20"));
  assert.equal(p.showHints, false);
  assert.equal(p.showWarning, false);
});
test("no rest restriction preserves seven-day capacity; new habits and pauses do not invent available dates", () => {
  const f = fixture("2026-11-16", 0, 3);
  assert.equal(f.status().capacity, 7);
  const s = structuredClone(f.state);
  s.habits[0].rules[0].effective = "2026-11-21";
  assert.equal(
    weeklyHabitStatus(s, s.habits[0], "2026-11-21", at("2026-11-20")).capacity,
    2,
  );
  s.habits[0].rules[0].paused = true;
  assert.equal(
    weeklyHabitStatus(s, s.habits[0], "2026-11-21", at("2026-11-20")).capacity,
    0,
  );
});
test("actual consecutive completion needs acknowledgement, remains recordable, and undo updates the advice", () => {
  const f = fixture();
  f.done("2026-11-19");
  assert.throws(
    () => f.run({ action: "habitLog", id: f.id, date: "2026-11-20", value: 1 }),
    /休息|间隔/,
  );
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-20",
    value: 1,
    confirmRest: true,
  });
  assert.equal(f.status().completed, 2);
  assert.throws(
    () =>
      f.run({
        action: "habitLog",
        id: f.id,
        date: "2026-11-20",
        value: 1,
        confirmRest: true,
      }),
    /已打卡/,
  );
  const log = f.state.habitLogs.find((x) => x.date === "2026-11-20");
  f.run({ action: "habitLog", id: f.id, date: "2026-11-20", removeId: log.id });
  assert.equal(f.status().completed, 1);
});
test("late backfill checks an existing following training day too", () => {
  const f = fixture();
  f.done("2026-11-20");
  assert.equal(
    habitRestInfo(f.state, f.habit, "2026-11-19", at("2026-11-20")).violation,
    true,
  );
  assert.throws(
    () => f.run({ action: "habitLog", id: f.id, date: "2026-11-19", value: 1 }),
    /休息|间隔/,
  );
});
test("natural day spacing is stable on a DST transition and in workspace timezone", () => {
  const f = fixture("2026-11-02");
  const s = structuredClone(f.state);
  s.settings.timeZone = "America/New_York";
  s.habits[0].rules[0].effective = "2026-10-01";
  s.habitLogs.push({
    id: "synthetic-sun",
    habitId: f.id,
    date: "2026-11-01",
    value: 1,
    skipped: false,
    missed: false,
    createdAt: "2026-11-02T02:00:00Z",
    updatedAt: "2026-11-02T02:00:00Z",
    version: 1,
    deletedAt: null,
    note: "",
  });
  const p = weeklyHabitStatus(
    s,
    s.habits[0],
    "2026-11-02",
    Date.parse("2026-11-02T17:00:00Z"),
  );
  assert.equal(p.restToday, true);
  assert.equal(p.nextEligible, "2026-11-03");
});
test("legacy rules default to no rest and keep their normal count semantics", () => {
  const r = HabitRule.parse({
    effective: "2026-11-01",
    mode: "weekly",
    target: 3,
  });
  assert.equal(r.restDays, 0);
  assert.equal(r.weeklyHints, true);
  assert.throws(() => HabitRule.parse({ ...r, restDays: 7 }), /6/);
  assert.throws(
    () => HabitRule.parse({ ...r, mode: "daily", restDays: 1 }),
    /每周/,
  );
});

test("date-effective rest changes preserve past rules and affect only future recommendations", () => {
  const f = fixture("2026-11-20", 1, 3),
    before = structuredClone(f.habit.rules[0]);
  f.run({
    action: "save",
    collection: "habits",
    id: f.id,
    version: f.habit.version,
    item: {
      rules: [
        ...f.habit.rules,
        { ...before, effective: "2026-11-21", restDays: 0 },
      ],
    },
  });
  assert.deepEqual(f.habit.rules[0], before);
  assert.equal(f.status().capacity, 3);
  assert.equal(f.status().changesWithinWeek, true);
  assert.deepEqual(f.status().suggested, [
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
  ]);
});
test("a changed or paused rule still allows cancelling an old plan without creating attendance", () => {
  const f = fixture();
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-22",
    status: "planned",
  });
  const before = structuredClone(f.habit.rules[0]);
  f.run({
    action: "save",
    collection: "habits",
    id: f.id,
    version: f.habit.version,
    item: {
      rules: [
        ...f.habit.rules,
        { ...before, effective: "2026-11-21", paused: true },
      ],
    },
  });
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-22",
    status: "unplanned",
  });
  assert.deepEqual(f.habit.plannedDates, []);
  assert.equal(f.state.habitLogs.length, 0);
});
test("read-only forecast and restored backup keep spacing, hints, plans and original rule history", async () => {
  const f = fixture(),
    base = structuredClone(f.state);
  base.habits[0].rules[0].weeklyHints = false;
  let global = base;
  const backups = {};
  let writes = 0;
  const unit = {
    async loadAll() {
      return structuredClone({ global, tables: { backups } });
    },
    async setGlobal(v) {
      writes++;
      global = structuredClone(v);
    },
    async putRecord(_t, k, v) {
      backups[k] = structuredClone(v);
    },
    async close() {},
  };
  let service = await createService(unit, () => at("2026-11-20"));
  const before = await service.operate({ action: "read" }),
    forecast = await service.operate({
      action: "plan",
      command: "habits",
      date: "2026-11-20",
    });
  assert.equal(writes, 0);
  assert.equal(forecast.weekly[0].capacity, 2);
  assert.equal(forecast.weekly[0].showWarning, false);
  assert.deepEqual(JSON.parse(JSON.stringify(forecast)), forecast);
  let next = await service.operate({
    action: "habitLog",
    revision: before.revision,
    id: f.id,
    date: "2026-11-22",
    status: "planned",
  });
  const backup = await service.operate({ action: "backup" });
  next = await service.operate({
    action: "habitLog",
    revision: next.revision,
    id: f.id,
    date: "2026-11-22",
    status: "unplanned",
  });
  await service.operate({
    action: "restoreBackup",
    revision: next.revision,
    backup,
    confirm: true,
  });
  await service.close();
  service = await createService(unit, () => at("2026-11-20"));
  const restored = await service.operate({ action: "read" });
  assert.equal(restored.habits[0].rules[0].restDays, 1);
  assert.equal(restored.habits[0].rules[0].weeklyHints, false);
  assert.deepEqual(restored.habits[0].plannedDates, ["2026-11-22"]);
  assert.equal(restored.habitLogs.length, 0);
  const after = await service.operate({
    action: "plan",
    command: "habits",
    date: "2026-11-20",
  });
  assert.deepEqual(after.weekly[0].suggested, ["2026-11-20", "2026-11-22"]);
  await service.close();
});

test("an existing Thursday plan constrains the real capacity instead of being ignored for a three-session goal", () => {
  const f = fixture("2026-11-18", 1, 3);
  f.run({
    action: "habitLog",
    id: f.id,
    date: "2026-11-19",
    status: "planned",
  });
  const p = f.status();
  assert.equal(p.capacity, 2);
  assert.equal(p.risk, "short");
  assert.deepEqual(p.suggested, ["2026-11-19", "2026-11-21"]);
  assert.deepEqual(p.plannedConflicts, []);
  assert.deepEqual(f.habit.plannedDates, ["2026-11-19"]);
});
test("valid plans beyond the remaining goal are retained without making extra actual completions", () => {
  const f = fixture("2026-11-18", 1, 1);
  for (const date of ["2026-11-20", "2026-11-22"])
    f.run({ action: "habitLog", id: f.id, date, status: "planned" });
  const p = f.status();
  assert.equal(p.remaining, 1);
  assert.deepEqual(p.suggested, ["2026-11-20", "2026-11-22"]);
  assert.equal(p.completed, 0);
  assert.equal(f.state.habitLogs.length, 0);
});
