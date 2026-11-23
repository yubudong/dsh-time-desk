import {
  habitDue,
  habitProgress,
  habitRule,
  monday,
  shift,
  today,
} from "./dates.js";
import { habitRestInfo } from "./weekly-habits.js";

export function habitCell(state, habit, date, now = Date.now()) {
  const rule = habitRule(habit, date);
  const progress = habitProgress(state, habit, date, now);
  const due = habitDue(habit, date);
  const future = date > today(state.settings.timeZone, now);
  const logged = state.habitLogs.some(
    (x) => !x.deletedAt && x.habitId === habit.id && x.date === date,
  );
  const planned = !!habit.plannedDates?.includes(date);
  const rest =
    rule?.mode === "weekly" && habitRestInfo(state, habit, date, now).violation;
  const status = progress.done
    ? progress.status === "late"
      ? "late"
      : "done"
    : progress.missed
      ? "missed"
      : progress.skipped
        ? "skipped"
        : progress.value > 0
          ? "partial"
          : !due
            ? "off"
            : future
              ? "future"
              : rule?.mode === "weekly" && !planned
                ? rest
                  ? "rest"
                  : "optional"
                : date < today(state.settings.timeZone, now)
                  ? "unrecorded"
                  : "pending";
  return {
    date,
    status,
    progress,
    rule,
    planned,
    future,
    logged,
    editable: !future && due,
    // Old records remain visible even when a later rule no longer schedules this day.
    viewable: !future && (due || logged),
    expected: due && (rule?.mode !== "weekly" || planned),
  };
}
export function habitDayGroups(state, date, now = Date.now()) {
  const groups = {
    pending: [],
    done: [],
    settled: [],
    weekly: [],
    other: [],
    total: 0,
  };
  for (const h of state.habits.filter((h) => !h.deletedAt)) {
    const cell = habitCell(state, h, date, now);
    if (cell.rule?.mode === "weekly" && habitDue(h, date))
      groups.weekly.push(h);
    if (cell.progress.done) groups.done.push(h);
    else if (cell.progress.missed || cell.progress.skipped)
      groups.settled.push(h);
    else if (cell.expected) groups.pending.push(h);
    else if (cell.rule?.mode !== "weekly" || !habitDue(h, date))
      groups.other.push(h);
    if (cell.expected || cell.progress.done) groups.total++;
  }
  return groups;
}
export function habitPeriod(date, view) {
  if (view === "week") {
    const from = monday(date);
    return {
      from,
      to: shift(from, 6),
      dates: Array.from({ length: 7 }, (_, i) => shift(from, i)),
    };
  }
  const from = date.slice(0, 7) + "-01";
  const d = new Date(from + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  const to = shift(d.toISOString().slice(0, 10), -1);
  const gridStart = monday(from);
  const gridEnd = shift(monday(to), 6);
  const dates = [];
  for (let day = gridStart; day <= gridEnd; day = shift(day, 1))
    dates.push(day);
  return { from, to, dates };
}
export function shiftHabitPeriod(date, view, direction) {
  if (view !== "month")
    return shift(date, direction * (view === "week" ? 7 : 1));
  const d = new Date(date.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + direction);
  const from = d.toISOString().slice(0, 10);
  const { to } = habitPeriod(from, "month");
  return (
    from.slice(0, 8) +
    String(Math.min(Number(date.slice(8)), Number(to.slice(8)))).padStart(
      2,
      "0",
    )
  );
}
