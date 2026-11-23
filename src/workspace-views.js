import { dailyPlan, planKey } from "./planning.js";
import { occurrences, shift, today } from "./dates.js";
import { lessonOccurrences } from "./lessons.js";
export {
  habitPeriod as workspacePeriod,
  shiftHabitPeriod as shiftWorkspacePeriod,
} from "./habit-history.js";

export function lifeView(state, date, category = "") {
  const tasks = state.tasks.filter(
    (x) =>
      !x.deletedAt && x.area === "life" && (!category || x.tag === category),
  );
  const scoped = { ...state, tasks };
  const plan = dailyPlan(scoped, date);
  const current = [
    ...new Map(
      [...plan.priority, ...plan.schedule, ...plan.todos].map((x) => [
        planKey(x),
        x,
      ]),
    ).values(),
  ];
  return {
    state: scoped,
    pending: current.filter((x) => !x.event),
    completed: plan.completed.filter((x) => !x.event),
    reminders: current.filter((x) => x.event),
    carried: plan.backlog,
    previousRecurring: plan.previousRecurring,
    due: plan.due,
    unscheduled: tasks.filter((x) => !x.date && x.status !== "done"),
    all: tasks,
  };
}
export function lifePeriodRows(state, from, to) {
  return occurrences(state, from, to).filter(
    (x) => !["cancelled", "skipped"].includes(x.status),
  );
}
function projectTask(state, task, date) {
  if (!task.date) return task;
  if (task.repeat?.kind !== "none") {
    // An ongoing series remains a project obligation; one completed month does
    // not finish the series. Point at the next executable occurrence instead.
    return (
      occurrences({ ...state, tasks: [task] }, date, shift(date, 366)).find(
        (x) => !["done", "skipped", "cancelled"].includes(x.status),
      ) || task
    );
  }
  const record = state.occurrences.find(
    (x) => !x.deletedAt && x.taskId === task.id,
  );
  const effectiveDate = record?.date || task.date;
  return (
    occurrences({ ...state, tasks: [task] }, effectiveDate, effectiveDate)[0] ||
    task
  );
}
export function projectOverview(
  state,
  project,
  date = today(state.settings.timeZone),
) {
  const tasks = state.tasks
    .filter((x) => !x.deletedAt && x.projectId === project.id)
    .map((x) => projectTask(state, x, date));
  const completed = tasks.filter((x) => x.status === "done");
  const pending = tasks.filter(
    (x) => !["done", "cancelled", "skipped"].includes(x.status),
  );
  const settled = tasks.filter((x) =>
    ["cancelled", "skipped"].includes(x.status),
  );
  const explicit = pending.find((x) => x.id === project.nextTaskId);
  const suggested = [...pending].sort(
    (a, b) =>
      (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) ||
      (a.deadline || a.date || "9999").localeCompare(
        b.deadline || b.date || "9999",
      ) ||
      a.createdAt.localeCompare(b.createdAt),
  )[0];
  return {
    tasks,
    pending,
    completed,
    settled,
    next: explicit || suggested || null,
    explicit: !!explicit,
    allDone: tasks.length > 0 && completed.length === tasks.length,
  };
}
export function lessonViewRows(state, lessons, from, to) {
  return lessons
    .filter((x) => !x.deletedAt)
    .flatMap((l) => lessonOccurrences(state, l, from, to))
    .sort((a, b) =>
      (a.date + (a.time || "99:99")).localeCompare(
        b.date + (b.time || "99:99"),
      ),
    );
}
