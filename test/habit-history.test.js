import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import {
  habitCell,
  habitDayGroups,
  habitPeriod,
  shiftHabitPeriod,
} from "../src/habit-history.js";
const date = "2026-11-23",
  now = Date.parse(date + "T07:00:00Z");
function fixture() {
  let state = blankState("synthetic-habit-views");
  return {
    get state() {
      return state;
    },
    act(a, time = now) {
      state = applyAction(state, { ...a, revision: state.revision }, time);
    },
    habit(title, rule = {}, extra = {}) {
      this.act({
        action: "save",
        collection: "habits",
        item: {
          title,
          ...extra,
          rules: [
            {
              effective: "2026-11-01",
              mode: "daily",
              target: 1,
              days: [0, 1, 2, 3, 4, 5, 6],
              ...rule,
            },
          ],
        },
      });
      return state.habits.at(-1);
    },
  };
}
test("day groups count scheduled work and actual weekly completions but not unplanned weekly obligations", () => {
  const f = fixture(),
    a = f.habit("Synthetic daily"),
    b = f.habit("Synthetic weekly", { mode: "weekly", target: 3 }),
    c = f.habit("Synthetic off", { days: [2] });
  let g = habitDayGroups(f.state, date, now);
  assert.deepEqual(
    g.pending.map((h) => h.id),
    [a.id],
  );
  assert.equal(g.total, 1);
  assert.equal(g.weekly[0].id, b.id);
  assert.equal(g.other[0].id, c.id);
  f.act({ action: "habitLog", id: b.id, date, value: 1 });
  g = habitDayGroups(f.state, date, now);
  assert.equal(g.done[0].id, b.id);
  assert.equal(g.total, 2);
  f.act({ action: "habitLog", id: a.id, date, value: 1 });
  g = habitDayGroups(f.state, date, now);
  assert.equal(g.pending.length, 0);
  assert.equal(g.done.length, 2);
});
test("weekly plans enter day obligations; resting or unplanned days stay separate", () => {
  const f = fixture(),
    h = f.habit("Synthetic training", {
      mode: "weekly",
      target: 3,
      restDays: 1,
    });
  f.act(
    { action: "habitLog", id: h.id, date: "2026-11-22", value: 1 },
    now - 86400000,
  );
  assert.equal(habitCell(f.state, f.state.habits[0], date, now).status, "rest");
  assert.equal(habitDayGroups(f.state, date, now).total, 0);
  f.act({
    action: "habitLog",
    id: h.id,
    date,
    status: "planned",
    confirmRest: true,
  });
  assert.equal(habitDayGroups(f.state, date, now).pending.length, 1);
  assert.equal(habitCell(f.state, f.state.habits[0], date, now).editable, true);
});
test("quantity records show partial, complete and undo without mutating source state", () => {
  const f = fixture(),
    h = f.habit("Synthetic quantity", {
      mode: "quantity",
      target: 100,
      unit: "units",
    });
  f.act({ action: "habitLog", id: h.id, date, value: 40 });
  const before = structuredClone(f.state);
  assert.equal(habitCell(f.state, h, date, now).status, "partial");
  assert.equal(habitCell(f.state, h, date, now).progress.value, 40);
  habitDayGroups(f.state, date, now);
  assert.deepEqual(f.state, before);
  f.act({ action: "habitLog", id: h.id, date, value: 60 });
  assert.equal(habitCell(f.state, h, date, now).status, "done");
  f.act({
    action: "habitLog",
    id: h.id,
    date,
    removeId: f.state.habitLogs.at(-1).id,
  });
  assert.equal(habitCell(f.state, h, date, now).status, "partial");
});
test("future, unscheduled, unrecorded, skipped and explicitly missed dates remain distinct", () => {
  const f = fixture(),
    h = f.habit("Synthetic daily");
  assert.equal(habitCell(f.state, h, "2026-11-24", now).status, "future");
  assert.equal(habitCell(f.state, h, "2026-11-24", now).viewable, false);
  assert.equal(habitCell(f.state, h, "2026-10-31", now).status, "off");
  assert.equal(habitCell(f.state, h, "2026-11-22", now).status, "unrecorded");
  f.act({ action: "habitLog", id: h.id, date, skipped: true });
  assert.equal(habitCell(f.state, h, date, now).status, "skipped");
  assert.equal(habitDayGroups(f.state, date, now).settled.length, 1);
  f.act({ action: "habitLog", id: h.id, date: "2026-11-22", status: "missed" });
  assert.equal(habitCell(f.state, h, "2026-11-22", now).status, "missed");
});
test("next-day allowance keeps yesterday's record on time; older completion remains late", () => {
  const f = fixture(),
    h = f.habit("Synthetic next-day", { allowNextDay: true });
  f.act({ action: "habitLog", id: h.id, date: "2026-11-22", value: 1 });
  assert.equal(habitCell(f.state, h, "2026-11-22", now).status, "done");
  f.act({ action: "habitLog", id: h.id, date: "2026-11-21", value: 1 });
  assert.equal(habitCell(f.state, h, "2026-11-21", now).status, "late");
  assert.equal(habitDayGroups(f.state, date, now).done.length, 0);
});
test("week and month periods respect Monday boundaries, leap February and year transitions", () => {
  assert.deepEqual(habitPeriod("2026-11-29", "week").dates, [
    "2026-11-23",
    "2026-11-24",
    "2026-11-25",
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
  ]);
  const p = habitPeriod("2028-02-19", "month");
  assert.equal(p.from, "2028-02-01");
  assert.equal(p.to, "2028-02-29");
  assert.equal(p.dates.length % 7, 0);
  assert.ok(p.dates.includes("2028-02-29"));
  assert.equal(shiftHabitPeriod("2028-01-31", "month", 1), "2028-02-29");
  assert.equal(shiftHabitPeriod("2026-12-31", "month", 1), "2027-01-31");
  assert.equal(shiftHabitPeriod("2026-11-23", "week", -1), "2026-11-16");
});
test("history stays visible when rules are paused, while off-day writes are unavailable", () => {
  const f = fixture(),
    h = f.habit("Synthetic paused");
  f.act({ action: "habitLog", id: h.id, date, value: 1 });
  const paused = { ...h, rules: [{ ...h.rules[0], paused: true }] };
  const c = habitCell(f.state, paused, date, now);
  assert.equal(c.status, "done");
  assert.equal(c.viewable, true);
  assert.equal(c.editable, false);
});
test("deleted habits and deleted log records do not inflate daily summaries", () => {
  const f = fixture(),
    h = f.habit("Synthetic deleted");
  f.act({ action: "habitLog", id: h.id, date, value: 1 });
  f.act({
    action: "habitLog",
    id: h.id,
    date,
    removeId: f.state.habitLogs[0].id,
  });
  assert.equal(habitDayGroups(f.state, date, now).done.length, 0);
  f.act({ action: "trash", collection: "habits", id: h.id });
  assert.equal(habitDayGroups(f.state, date, now).total, 0);
});
