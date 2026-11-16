import { occurrences, shift } from "./dates.js";
import { todayTasks } from "./today-view.js";
export const planKey = (x) => x.id + "@" + (x.originalDate || x.date || "");
export const inboxTasks = (state) =>
  state.tasks.filter(
    (x) =>
      !x.deletedAt &&
      x.status !== "done" &&
      !x.date &&
      !x.projectId &&
      x.area === "inbox",
  );
export function estimateTask(task, focusMinutes) {
  if (task.minutes > 0) return { minutes: task.minutes, basis: "minutes" };
  if (!task.event && task.pomodoros > 0)
    return { minutes: task.pomodoros * focusMinutes, basis: "pomodoros" };
  return { minutes: null, basis: "unknown" };
}
export function dailyPlan(
  state,
  date,
  items = occurrences(state, shift(date, -365), shift(date, 366)),
) {
  const groups = todayTasks(state, items, date);
  const saved = (state.dayPlans || []).find((p) => p.date === date);
  const selected = new Set(
    (saved?.selected || []).map((x) => x.taskId + "@" + (x.originalDate || "")),
  );
  const plannedCarry = groups.todos.filter(
    (x) => x.carriedFrom && selected.has(planKey(x)),
  );
  const backlog = groups.todos.filter(
    (x) => x.carriedFrom && !selected.has(planKey(x)),
  );
  const todos = groups.todos.filter((x) => !x.carriedFrom);
  const plan = [
    ...new Map(
      [...groups.priority, ...groups.schedule, ...todos, ...plannedCarry].map(
        (x) => [planKey(x), x],
      ),
    ).values(),
  ];
  const estimates = plan.map((task) => ({
    task,
    ...estimateTask(task, state.settings.focusMinutes),
  }));
  const knownMinutes = estimates.reduce((sum, x) => sum + (x.minutes ?? 0), 0);
  const availableMinutes = saved?.availableMinutes ?? null;
  return {
    date,
    priority: groups.priority,
    schedule: groups.schedule,
    todos: [...todos, ...plannedCarry],
    backlog,
    completed: groups.completed,
    previousRecurring: groups.previousRecurring,
    due: groups.due,
    load: {
      knownMinutes,
      unknownCount: estimates.filter((x) => x.minutes === null).length,
      pomodoroCount: estimates.filter((x) => x.basis === "pomodoros").length,
      availableMinutes,
      overMinutes:
        availableMinutes === null
          ? null
          : Math.max(0, knownMinutes - availableMinutes),
      taskCount: plan.length,
      recordedFocusMinutes: Math.round(
        state.focusLogs
          .filter((x) => !x.deletedAt && x.date === date)
          .reduce((sum, x) => sum + x.seconds, 0) / 60,
      ),
    },
  };
}
