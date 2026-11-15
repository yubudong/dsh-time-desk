import { habitDue, habitRule, habitProgress, shift } from "./dates.js";
export function taskFocus(state, task, originalDate) {
  const recurring = task.repeat?.kind && task.repeat.kind !== "none";
  const match = (x) =>
    x.taskId === task.id &&
    (!recurring ||
      x.originalDate === (originalDate || task.originalDate || task.date));
  return {
    completed: state.focusLogs.filter(
      (x) => !x.deletedAt && x.completed && match(x),
    ).length,
    expected: task.pomodoros || 0,
    running: !!(state.timer?.phase === "focus" && match(state.timer)),
  };
}
export function todayTasks(state, items, date) {
  const tasks = state.tasks.filter((x) => !x.deletedAt);
  const current = items.filter((x) => x.date === date);
  const active = current.filter(
    (x) => !["done", "skipped", "cancelled"].includes(x.status),
  );
  const priority = tasks
    .filter((x) => x.priorityDate === date)
    .map((x) => current.find((c) => c.id === x.id) || x)
    .filter((x) => !["done", "skipped", "cancelled"].includes(x.status));
  const ids = new Set(priority.map((x) => x.id));
  return {
    priority,
    schedule: active.filter((x) => x.time || x.event),
    todos: active.filter((x) => !x.time && !x.event && !ids.has(x.id)),
    due: tasks
      .filter(
        (x) =>
          x.deadline &&
          x.deadline <= shift(date, 7) &&
          x.status !== "done" &&
          !x.event,
      )
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
  };
}
export function todayHabits(state, date) {
  const eligible = state.habits.filter(
    (h) => !h.deletedAt && habitDue(h, date),
  );
  const weekly = eligible.filter((h) => habitRule(h, date).mode === "weekly");
  const daily = eligible.filter(
    (h) =>
      habitRule(h, date).mode !== "weekly" || h.plannedDates?.includes(date),
  );
  const p = (h) => habitProgress(state, h, date);
  return {
    pending: daily.filter((h) => !p(h).done && !p(h).skipped && !p(h).missed),
    done: eligible.filter((h) => p(h).done),
    settled: eligible.filter(
      (h) => !p(h).done && (p(h).skipped || p(h).missed),
    ),
    weekly,
  };
}
