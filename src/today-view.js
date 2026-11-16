import {
  habitDue,
  habitRule,
  habitProgress,
  shift,
  occurrences,
  today,
} from "./dates.js";
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
const unfinished = (x) => !["done", "skipped", "cancelled"].includes(x.status);
// One-off and completion-based tasks have one outstanding obligation. Calendar
// recurrences remain separate occurrences rather than accumulating in Today.
const singleOutstanding = (x) =>
  !x.repeat || ["none", "completion"].includes(x.repeat.kind);
const occurrenceKey = (x) => x.id + "@" + (x.originalDate || x.date || "");
function outstandingView(state, task) {
  if (!task.date) return task;
  const record = state.occurrences.find(
    (x) =>
      x.taskId === task.id &&
      !x.deletedAt &&
      (task.repeat?.kind !== "completion" || x.originalDate === task.date),
  );
  const effectiveDate = record?.date || task.date;
  // Resolve one day per task, including old tasks outside the calendar window.
  // Reuse the calendar's override/status/identity semantics without moving data.
  return (
    occurrences({ ...state, tasks: [task] }, effectiveDate, effectiveDate).find(
      (x) => x.originalDate === (record?.originalDate || task.date),
    ) || task
  );
}
export function todayTasks(state, items, date) {
  const tasks = state.tasks.filter((x) => !x.deletedAt);
  const current = items.filter((x) => !x.deletedAt && x.date === date);
  const singles = new Map(
    tasks
      .filter(singleOutstanding)
      .map((x) => [x.id, outstandingView(state, x)]),
  );
  const carried = [...singles.values()]
    .filter((x) => x.date && x.date < date && !x.event && unfinished(x))
    .map((x) => ({ ...x, carriedFrom: x.date }))
    .sort((a, b) =>
      (a.date + (a.time || "99:99")).localeCompare(
        b.date + (b.time || "99:99"),
      ),
    );
  const active = current.filter(unfinished);
  const priority = tasks
    .filter((x) => x.priorityDate === date)
    .map(
      (x) =>
        current.find((c) => c.id === x.id) ||
        carried.find((c) => c.id === x.id) ||
        singles.get(x.id) ||
        x,
    )
    .filter(unfinished);
  const ids = new Set(priority.map((x) => x.id));
  const priorityKeys = new Set(priority.map(occurrenceKey));
  const completed = [
    ...new Map(
      [...items, ...singles.values()]
        .filter(
          (x) =>
            !x.deletedAt &&
            x.status === "done" &&
            (x.date === date ||
              (x.completedAt &&
                today(state.settings.timeZone, Date.parse(x.completedAt)) ===
                  date)),
        )
        .map((x) => [occurrenceKey(x), x]),
    ).values(),
  ];
  return {
    priority,
    schedule: active.filter((x) => x.time || x.event),
    todos: [
      ...carried.filter((x) => !ids.has(x.id)),
      ...active.filter((x) => !x.time && !x.event && !ids.has(x.id)),
    ],
    completed,
    previousRecurring: items.filter(
      (x) =>
        x.date < date &&
        !x.deletedAt &&
        !x.event &&
        !singleOutstanding(x) &&
        unfinished(x) &&
        !priorityKeys.has(occurrenceKey(x)),
    ),
    due: tasks
      .filter(
        (x) =>
          x.deadline &&
          x.deadline <= shift(date, 7) &&
          unfinished(singles.get(x.id) || x) &&
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
