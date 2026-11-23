import test from "node:test";
import assert from "node:assert/strict";
import { blankState, State } from "../src/schema.js";
import { applyAction, createService } from "../src/model.js";
import {
  lifeView,
  lifePeriodRows,
  projectOverview,
  lessonViewRows,
} from "../src/workspace-views.js";
import { dailyPlan } from "../src/planning.js";
import { occurrences } from "../src/dates.js";
import { lessonAccount } from "../src/lessons.js";
const day = "2026-11-23",
  now = Date.parse(day + "T07:00:00Z");
function fixture() {
  let state = blankState("synthetic-workspace-views");
  return {
    get state() {
      return state;
    },
    act(a) {
      state = applyAction(state, { ...a, revision: state.revision }, now);
      return state;
    },
    task(item) {
      this.act({ action: "save", collection: "tasks", item });
      return state.tasks.at(-1);
    },
    project(title = "Synthetic project") {
      this.act({
        action: "save",
        collection: "projects",
        item: { title, goal: "Synthetic outcome" },
      });
      return state.projects.at(-1);
    },
  };
}
test("life day scopes area and tag, separates reminders and leaves unscheduled work out of today's count", () => {
  const f = fixture();
  f.task({ title: "Synthetic today", date: day, area: "life", tag: "sample" });
  f.task({ title: "Synthetic work", date: day, area: "work" });
  f.task({ title: "Synthetic no date", area: "life", tag: "sample" });
  f.task({
    title: "Synthetic birthday",
    date: day,
    area: "life",
    tag: "sample",
    event: true,
  });
  f.task({
    title: "Synthetic other category",
    date: day,
    area: "life",
    tag: "other",
  });
  const g = lifeView(f.state, day, "sample");
  assert.equal(g.pending.length, 1);
  assert.equal(g.reminders.length, 1);
  assert.equal(g.unscheduled.length, 1);
  assert.equal(g.all.length, 3);
});
test("carried life tasks enter selected day only when picked; completion syncs calendar and deadline", () => {
  const f = fixture(),
    task = f.task({
      title: "Synthetic carried",
      area: "life",
      date: "2026-11-22",
      deadline: day,
    });
  assert.equal(lifeView(f.state, day).carried.length, 1);
  assert.equal(lifeView(f.state, day).pending.length, 0);
  f.act({
    action: "plan",
    command: "pick",
    id: task.id,
    date: day,
    originalDate: task.date,
  });
  assert.equal(lifeView(f.state, day).pending.length, 1);
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: task.date,
    status: "done",
  });
  const g = lifeView(f.state, day);
  assert.equal(g.completed.length, 1);
  assert.equal(g.pending.length, 0);
  assert.equal(g.due.length, 0);
  assert.equal(occurrences(f.state, task.date, task.date)[0].status, "done");
});
test("life recurrence is completed per occurrence and leaves future repayments pending", () => {
  const f = fixture(),
    task = f.task({
      title: "Synthetic monthly bill",
      area: "life",
      date: day,
      deadline: day,
      repeat: { kind: "monthly", day: 23 },
    });
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: day,
    status: "done",
  });
  const g = lifeView(f.state, day);
  assert.equal(g.pending.length, 0);
  assert.equal(g.completed.length, 1);
  assert.equal(g.due.length, 0);
  const next = lifePeriodRows(g.state, "2026-12-23", "2026-12-23");
  assert.equal(next[0].status, "todo");
});
test("legacy project data normalizes optional next step and archive without changing old status", () => {
  const f = fixture(),
    p = f.project();
  const raw = structuredClone(f.state);
  delete raw.projects[0].nextTaskId;
  delete raw.projects[0].archived;
  raw.projects[0].status = "paused";
  const parsed = State.parse(raw);
  assert.equal(parsed.projects[0].archived, false);
  assert.equal(parsed.projects[0].nextTaskId, "");
  assert.equal(parsed.projects[0].status, "paused");
  assert.equal(parsed.projects[0].goal, p.goal);
});
test("project completion is synchronized with occurrence actions but never completes the project automatically", () => {
  const f = fixture(),
    p = f.project(),
    task = f.task({
      title: "Synthetic project task",
      projectId: p.id,
      date: day,
      area: "work",
    });
  f.task({ title: "Synthetic unscheduled", projectId: p.id, area: "work" });
  assert.equal(dailyPlan(f.state, day).todos.length, 1);
  assert.equal(projectOverview(f.state, p, day).pending.length, 2);
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: day,
    status: "done",
  });
  assert.equal(projectOverview(f.state, p, day).completed.length, 1);
  const other = f.state.tasks[1];
  f.act({
    action: "save",
    collection: "tasks",
    id: other.id,
    item: { status: "done" },
  });
  assert.equal(projectOverview(f.state, p, day).allDone, true);
  assert.equal(f.state.projects[0].status, "todo");
  f.act({
    action: "save",
    collection: "projects",
    id: p.id,
    item: { status: "done" },
  });
  assert.equal(f.state.projects[0].status, "done");
});
test("explicit next step wins suggestion; finished, deleted or reassigned choices safely fall back", () => {
  const f = fixture(),
    p = f.project(),
    a = f.task({ title: "Synthetic early", date: day, projectId: p.id }),
    b = f.task({ title: "Synthetic next", projectId: p.id });
  f.act({
    action: "save",
    collection: "projects",
    id: p.id,
    item: { nextTaskId: b.id },
  });
  let current = f.state.projects[0];
  assert.equal(projectOverview(f.state, current, day).next.id, b.id);
  f.act({
    action: "save",
    collection: "tasks",
    id: b.id,
    item: { status: "done" },
  });
  assert.equal(projectOverview(f.state, current, day).next.id, a.id);
  assert.equal(projectOverview(f.state, current, day).explicit, false);
  f.act({ action: "trash", collection: "tasks", id: a.id });
  assert.equal(projectOverview(f.state, current, day).next, null);
});
test("next step cannot point into another project and archive keeps tasks and daily plans intact", () => {
  const f = fixture(),
    p = f.project(),
    other = f.project("Synthetic other"),
    task = f.task({
      title: "Synthetic foreign",
      projectId: other.id,
      date: day,
    });
  assert.throws(
    () =>
      f.act({
        action: "save",
        collection: "projects",
        id: p.id,
        item: { nextTaskId: task.id },
      }),
    /本项目/,
  );
  const before = structuredClone(f.state.tasks);
  f.act({
    action: "save",
    collection: "projects",
    id: p.id,
    item: { archived: true },
  });
  assert.deepEqual(f.state.tasks, before);
  assert.equal(dailyPlan(f.state, day).todos.length, 1);
  assert.equal(f.state.projects[0].archived, true);
  f.act({
    action: "save",
    collection: "projects",
    id: p.id,
    item: { archived: false },
  });
  assert.equal(f.state.projects[0].archived, false);
});
test("completed recurring project instance points to the next occurrence instead of finishing its series", () => {
  const f = fixture(),
    p = f.project(),
    task = f.task({
      title: "Synthetic recurring project task",
      projectId: p.id,
      date: day,
      repeat: { kind: "monthly", day: 23 },
    });
  f.act({
    action: "occurrence",
    id: task.id,
    originalDate: day,
    status: "done",
  });
  const view = projectOverview(f.state, p, day);
  assert.equal(view.allDone, false);
  assert.equal(view.next.originalDate, "2026-12-23");
});
test("course views preserve ledger and align moved, skipped and completed sessions across periods", () => {
  const f = fixture();
  f.act({
    action: "lesson",
    item: {
      title: "Synthetic course",
      participant: "Example",
      mode: "credit",
      effective: "2026-11-01",
      weekdays: [1],
      time: "09:00",
      durationMinutes: 60,
    },
    opening: 5,
  });
  const lesson = f.state.lessons[0];
  let rows = lessonViewRows(f.state, [lesson], day, day);
  assert.equal(rows[0].status, "scheduled");
  f.act({
    action: "lessonSession",
    command: "complete",
    id: lesson.id,
    originalDate: day,
    deduction: 1,
  });
  assert.equal(lessonAccount(f.state, lesson).balance, 4);
  const before = structuredClone(f.state);
  for (const [from, to] of [
    [day, day],
    [day, "2026-11-29"],
    ["2026-11-01", "2026-11-30"],
  ])
    assert.equal(
      lessonViewRows(f.state, [lesson], from, to).find(
        (x) => x.originalDate === day,
      ).status,
      "done",
    );
  assert.deepEqual(f.state, before);
  const session = f.state.lessonSessions[0];
  f.act({
    action: "lessonSession",
    command: "undo",
    id: lesson.id,
    sessionId: session.id,
  });
  assert.equal(lessonAccount(f.state, lesson).balance, 5);
  assert.equal(
    lessonViewRows(f.state, [lesson], day, day)[0].status,
    "scheduled",
  );
  f.act({
    action: "lessonSession",
    command: "save",
    id: lesson.id,
    originalDate: day,
    date: "2026-11-24",
    time: "10:00",
  });
  assert.equal(lessonViewRows(f.state, [lesson], day, day).length, 0);
  rows = lessonViewRows(f.state, [lesson], "2026-11-24", "2026-11-24");
  assert.equal(rows[0].originalDate, day);
  assert.equal(rows[0].movedFrom, day);
  f.act({
    action: "lessonSession",
    command: "skip",
    id: lesson.id,
    originalDate: day,
    sessionId: rows[0].sessionId,
    deduction: 0,
  });
  assert.equal(
    lessonViewRows(f.state, [lesson], "2026-11-24", "2026-11-24")[0].status,
    "skipped",
  );
  assert.equal(lessonAccount(f.state, lesson).balance, 5);
});
test("new project metadata survives service reopen and backup serialization", async () => {
  const f = fixture(),
    p = f.project(),
    task = f.task({ title: "Synthetic stored next", projectId: p.id });
  f.act({
    action: "save",
    collection: "projects",
    id: p.id,
    item: { nextTaskId: task.id, archived: true },
  });
  let global = f.state;
  const unit = {
    async loadAll() {
      return structuredClone({ global, tables: { backups: {} } });
    },
    async setGlobal(x) {
      global = structuredClone(x);
    },
    async close() {},
  };
  let service = await createService(unit, () => now);
  await service.close();
  service = await createService(unit, () => now);
  const fresh = await service.operate({ action: "read" });
  assert.equal(fresh.projects[0].nextTaskId, task.id);
  assert.equal(fresh.projects[0].archived, true);
  const restored = State.parse(JSON.parse(JSON.stringify(fresh)));
  assert.equal(
    projectOverview(restored, restored.projects[0], day).next.id,
    task.id,
  );
  await service.close();
});
