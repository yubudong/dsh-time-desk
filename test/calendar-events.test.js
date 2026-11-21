import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFieldSpecs,
  compareByFieldSpecs,
} from "@fullcalendar/core/internal";
import { calendarEvents, calendarEventOrder } from "../src/calendar-events.js";
import { blankState } from "../src/schema.js";
import { applyAction } from "../src/model.js";
const date = "2026-11-21",
  now = Date.parse(date + "T04:00:00Z");
function fixture() {
  let state = blankState("synthetic-calendar");
  return {
    get state() {
      return state;
    },
    act(a) {
      state = applyAction(state, { ...a, revision: state.revision }, now);
    },
    task(item) {
      this.act({ action: "save", collection: "tasks", item });
      return state.tasks.at(-1);
    },
    events(from = date, to = from, filter = "all") {
      return calendarEvents(state, from, to, filter);
    },
  };
}
test("monthly completion is marked only on that occurrence; undo and other periods remain pending", () => {
  const f = fixture(),
    task = f.task({
      title: "Synthetic monthly",
      date,
      repeat: { kind: "monthly", day: 21 },
    });
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: date,
    status: "done",
  });
  const original = structuredClone(f.state);
  const events = f.events(date, "2026-12-21");
  assert.equal(events[0].title, "✓ Synthetic monthly");
  assert.ok(events[0].classNames.includes("ld-event-done"));
  assert.equal(events[1].title, "Synthetic monthly");
  assert.equal(events[1].extendedProps.completionOrder, 0);
  assert.equal(events[0].extendedProps.source.originalDate, date);
  assert.deepEqual(f.state, original);
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: date,
    status: "todo",
  });
  assert.equal(f.events()[0].title, "Synthetic monthly");
  assert.equal(f.events()[0].classNames.includes("ld-event-done"), false);
});
test("daily habit needs enough logged progress, not a past date or a skipped/missed flag", () => {
  const f = fixture();
  f.act({
    action: "save",
    collection: "habits",
    item: {
      title: "Synthetic quantity",
      rules: [
        {
          effective: "2026-11-20",
          mode: "quantity",
          target: 10,
          days: [0, 1, 2, 3, 4, 5, 6],
        },
      ],
    },
  });
  const h = f.state.habits[0];
  f.act({ action: "habitLog", id: h.id, date, value: 4 });
  assert.equal(f.events()[0].title, h.title);
  f.act({ action: "habitLog", id: h.id, date, value: 6 });
  assert.equal(f.events()[0].title, "✓ " + h.title);
  assert.ok(f.events()[0].classNames.includes("ld-event-habit"));
  const next = "2026-11-20";
  f.act({ action: "habitLog", id: h.id, date: next, status: "missed" });
  assert.equal(f.events(next)[0].title, h.title);
  f.act({ action: "habitLog", id: h.id, date: next, skipped: true });
  assert.equal(f.events(next)[0].extendedProps.completionOrder, 0);
  f.act({
    action: "habitLog",
    id: h.id,
    date,
    removeId: f.state.habitLogs[1].id,
  });
  assert.equal(f.events()[0].title, h.title);
});
test("lesson is marked from attendance, while an unrecorded past session stays pending", () => {
  const f = fixture();
  f.state.lessons.push({
    id: "synthetic-lesson",
    title: "Synthetic lesson",
    participant: "Example",
    place: "",
    mode: "none",
    weekdays: [6],
    time: "09:00",
    durationMinutes: 60,
    effective: date,
    until: "",
    deletedAt: null,
  });
  let event = f.events()[0];
  assert.equal(event.title, "Synthetic lesson · Example");
  assert.equal(event.extendedProps.completionOrder, 0);
  f.state.lessonSessions.push({
    id: "synthetic-session",
    lessonId: "synthetic-lesson",
    originalDate: date,
    date,
    time: "09:00",
    place: "",
    status: "done",
    extra: false,
    deletedAt: null,
  });
  event = f.events()[0];
  assert.equal(event.title, "✓ Synthetic lesson · Example");
  assert.ok(event.classNames.includes("ld-event-lesson"));
  assert.equal(event.extendedProps.lesson.originalDate, date);
  assert.equal(event.start, date + "T09:00");
  assert.equal(event.end, date + "T10:00:00.000");
});
test("month order prioritizes pending items, while week/day order preserves appointment times", () => {
  const done = {
    start: 1,
    duration: 60,
    allDay: false,
    title: "✓ Earlier",
    completionOrder: 1,
  };
  const pending = {
    start: 2,
    duration: 60,
    allDay: false,
    title: "Later",
    completionOrder: 0,
  };
  const order = (view) =>
    [done, pending].sort((a, b) =>
      compareByFieldSpecs(a, b, parseFieldSpecs(calendarEventOrder(view))),
    );
  assert.equal(order("dayGridMonth")[0], pending);
  assert.equal(order("timeGridWeek")[0], done);
  assert.equal(order("timeGridDay")[0], done);
});
test("filters, cancelled exclusions and click/drag source identities survive presentation", () => {
  const f = fixture();
  const a = f.task({ title: "Synthetic work", date, area: "work" });
  const b = f.task({ title: "Synthetic life", date, area: "life" });
  f.act({
    action: "occurrence",
    id: a.id,
    originalDate: date,
    status: "cancelled",
  });
  assert.equal(f.events(date, date, "work").length, 0);
  const event = f.events(date, date, "life")[0];
  assert.equal(event.id, b.id + "@" + date);
  assert.equal(event.extendedProps.source.id, b.id);
  assert.equal(event.extendedProps.source.title, "Synthetic life");
  assert.equal(f.events(date, date, "habits").length, 0);
  assert.equal(f.events(date, date, "lessons").length, 0);
});
