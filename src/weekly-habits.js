import {
  habitDue,
  habitProgress,
  habitRule,
  monday,
  shift,
  today,
} from "./dates.js";
/** Actual completion dates only. Plans, skipped logs and duplicate writes are not training. */
export function habitCompletedDates(state, habit, now = Date.now()) {
  const localDay = today(state.settings.timeZone, now);
  const totals = new Map();
  for (const row of state.habitLogs) {
    if (
      row.deletedAt ||
      row.habitId !== habit.id ||
      row.skipped ||
      row.date > localDay
    )
      continue;
    totals.set(row.date, (totals.get(row.date) || 0) + row.value);
  }
  return [...totals]
    .filter(([date, value]) => {
      const rule = habitRule(habit, date);
      return (
        !!rule &&
        value >=
          (["quantity", "duration"].includes(rule.mode) ? rule.target : 1)
      );
    })
    .map(([date]) => date)
    .sort();
}
function spacing(earlier, later, habit) {
  const rule = habitRule(habit, later);
  const rest = rule?.mode === "weekly" ? rule.restDays || 0 : 0;
  return later > shift(earlier, rest);
}
/** A restriction is advisory: callers can confirm actual attendance even on a rest day. */
export function habitRestInfo(
  state,
  habit,
  date,
  now = Date.now(),
  includePlans = false,
  knownDates = null,
) {
  const rule = habitRule(habit, date);
  const done = knownDates || habitCompletedDates(state, habit, now);
  const dates = [
    ...new Set([
      ...done,
      ...(includePlans
        ? (habit.plannedDates || []).filter(
            (d) =>
              d >= today(state.settings.timeZone, now) &&
              habitDue(habit, d) &&
              habitRule(habit, d)?.mode === "weekly",
          )
        : []),
    ]),
  ]
    .filter((d) => d !== date)
    .sort();
  const previous = dates.filter((d) => d < date).at(-1) || "";
  const next = dates.find((d) => d > date) || "";
  const before = !!previous && !spacing(previous, date, habit);
  const after = !!next && !spacing(date, next, habit);
  return {
    restDays: rule?.mode === "weekly" ? rule.restDays || 0 : 0,
    previous,
    next,
    violation: before || after,
    earliest: previous
      ? shift(previous, (rule?.mode === "weekly" ? rule.restDays || 0 : 0) + 1)
      : date,
  };
}
/** A seven-day search honours spacing and prefers valid existing plans, then earlier dates. */
export function weeklyHabitStatus(state, habit, viewDate, now = Date.now()) {
  const rule = habitRule(habit, viewDate);
  const from = monday(viewDate),
    to = shift(from, 6),
    localDay = today(state.settings.timeZone, now);
  const completedDates = habitCompletedDates(state, habit, now);
  const completed = completedDates.filter((d) => d >= from && d <= to);
  const target = rule?.mode === "weekly" ? rule.target : 0;
  const remaining = Math.max(0, target - completed.length);
  const past = to < localDay;
  const start = localDay > from ? localDay : from;
  const candidates = [];
  const actualPlans = [...new Set(habit.plannedDates || [])].filter(
    (d) => d >= start && d <= to && !completedDates.includes(d),
  );
  for (let date = start; date <= to; date = shift(date, 1)) {
    const r = habitRule(habit, date),
      p = habitProgress(state, habit, date, now);
    if (
      r?.mode !== "weekly" ||
      !habitDue(habit, date) ||
      p.done ||
      p.skipped ||
      p.missed
    )
      continue;
    if (habitRestInfo(state, habit, date, now, false, completedDates).violation)
      continue;
    candidates.push(date);
  }
  const feasible = [];
  for (let mask = 0; mask < 1 << candidates.length; mask++) {
    const chosen = candidates.filter((_d, i) => mask & (1 << i));
    if (chosen.some((d, i) => i > 0 && !spacing(chosen[i - 1], d, habit)))
      continue;
    feasible.push(chosen);
  }
  const plannedConflicts = actualPlans.filter(
    (d) =>
      !candidates.includes(d) ||
      habitRestInfo(state, habit, d, now, true, completedDates).violation,
  );
  const fixedPlans = actualPlans.filter((d) => !plannedConflicts.includes(d));
  const compatible = feasible.filter((ds) =>
    fixedPlans.every((d) => ds.includes(d)),
  );
  const capacity = compatible.reduce((m, ds) => Math.max(m, ds.length), 0);
  const want =
    remaining === 0
      ? 0
      : Math.max(Math.min(remaining, capacity), fixedPlans.length);
  const planned = new Set(actualPlans);
  const score = (ds) => ds.filter((d) => planned.has(d)).length;
  const choices = compatible
    .filter((ds) => ds.length === want)
    .sort(
      (a, b) => score(b) - score(a) || a.join(",").localeCompare(b.join(",")),
    );
  const suggested = remaining === 0 ? [] : choices[0] || [];
  const dayProgress = habitProgress(state, habit, viewDate, now);
  const rest = habitRestInfo(
    state,
    habit,
    viewDate,
    now,
    false,
    completedDates,
  );
  const applicable =
    rule?.mode === "weekly" && !rule.paused && !habit.deletedAt;
  const risk = past
    ? "historical"
    : !remaining
      ? "complete"
      : capacity < remaining
        ? "short"
        : capacity === remaining
          ? "tight"
          : "open";
  return {
    habitId: habit.id,
    title: habit.title,
    from,
    to,
    localDay,
    target,
    completed: completed.length,
    completedDates: completed,
    remaining,
    capacity,
    suggested,
    availableDates: candidates,
    plannedDates: actualPlans,
    plannedConflicts,
    changesWithinWeek: habit.rules.some(
      (r) => r.effective > from && r.effective <= to,
    ),
    restDays: rule?.restDays || 0,
    restToday:
      applicable &&
      viewDate === localDay &&
      !dayProgress.done &&
      rest.violation,
    nextEligible:
      candidates.find((d) => compatible.some((ds) => ds.includes(d))) || "",
    nextUnplanned: suggested.find((d) => !planned.has(d)) || "",
    todayDone: dayProgress.done,
    applicable,
    risk,
    showHints: applicable && !past && (rule?.weeklyHints ?? true),
    showWarning:
      applicable &&
      !past &&
      viewDate === localDay &&
      (rule?.weeklyHints ?? true) &&
      remaining > 0,
  };
}
