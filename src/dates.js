import { Lunar, LunarYear, Solar } from "lunar-typescript";
import rrulePkg from "rrule/dist/es5/rrule.js";
const { RRule } = rrulePkg;
export const DAY = 86400000;
export function validDate(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s
  );
}
export const shift = (d, n) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
export const weekday = (d) => new Date(d + "T00:00:00Z").getUTCDay();
export const monday = (d) => shift(d, -((weekday(d) + 6) % 7));
export function today(zone = "Asia/Shanghai", now = Date.now()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const v = (k) => p.find((x) => x.type === k).value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}
export function zonedStamp(date, time, zone) {
  const target = Date.parse(date + "T" + (time || "09:00") + ":00Z");
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const v = (k) => p.find((x) => x.type === k).value;
    const local = Date.parse(
      `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}:${v("second")}Z`,
    );
    if (local === target) return guess;
    guess += target - local;
  }
  throw new Error("该当地时间不存在，请避开夏令时跳过的时刻");
}
export function lunarLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  const l = Solar.fromYmd(y, m, d).getLunar();
  return `农历${l.getMonthInChinese()}月${l.getDayInChinese()}`;
}
export function lunarDates(rule, from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)); y++) {
    const months = LunarYear.fromYear(y)
      .getMonths()
      .filter(
        (m) => m.getYear() === y && Math.abs(m.getMonth()) === rule.month,
      );
    let picks = months.filter(
      (m) =>
        rule.leap === "both" ||
        (rule.leap === "only" ? m.getMonth() < 0 : m.getMonth() > 0),
    );
    if (
      !picks.length &&
      rule.leap === "only" &&
      rule.leapFallback === "regular"
    )
      picks = months.filter((m) => m.getMonth() > 0);
    for (const m of picks) {
      if (rule.day > m.getDayCount() && rule.missing === "skip") continue;
      const solar = Lunar.fromYmd(
        y,
        m.getMonth(),
        Math.min(rule.day, m.getDayCount()),
      )
        .getSolar()
        .toYmd();
      if (solar >= from && solar <= to) out.push(solar);
    }
  }
  return out.sort();
}
export function ruleDates(task, from, to) {
  const r = task.repeat;
  const start = task.date;
  if (!start || start > to) return [];
  const lo = from > start ? from : start;
  const hi = r?.until && r.until < to ? r.until : to;
  if (lo > hi) return [];
  if (!r || r.kind === "none") return start >= lo && start <= hi ? [start] : [];
  if (r.kind === "lunar") return lunarDates(r, lo, hi);
  if (r.kind === "completion") return start >= lo && start <= hi ? [start] : [];
  // Explicit month-end policy; do not let RFC invalid-date skipping silently decide it.
  if (
    (r.kind === "monthly" || r.kind === "yearly") &&
    r.monthMode !== "lastWeekday"
  ) {
    const out = [];
    const base = new Date(start + "T00:00:00Z");
    const targetDay = base.getUTCDate();
    for (
      let year = Number(lo.slice(0, 4));
      year <= Number(hi.slice(0, 4));
      year++
    )
      for (let month = 1; month <= 12; month++) {
        const delta =
          (year - base.getUTCFullYear()) * 12 + month - 1 - base.getUTCMonth();
        if (
          delta < 0 ||
          (r.kind === "monthly"
            ? delta % r.interval
            : month !== base.getUTCMonth() + 1 ||
              (year - base.getUTCFullYear()) % r.interval)
        )
          continue;
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        if (targetDay > last && r.missing === "skip") continue;
        const d = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(targetDay, last)).padStart(2, "0")}`;
        if (d >= lo && d <= hi) out.push(d);
      }
    return out;
  }
  const opts = {
    freq: {
      daily: RRule.DAILY,
      weekly: RRule.WEEKLY,
      monthly: RRule.MONTHLY,
      yearly: RRule.YEARLY,
    }[r.kind],
    interval: r.interval,
    dtstart: new Date(start + "T00:00:00Z"),
  };
  if (r.kind === "weekly") opts.byweekday = r.days.map((x) => (x + 6) % 7);
  if (r.monthMode === "lastWeekday") {
    opts.byweekday = [0, 1, 2, 3, 4];
    opts.bysetpos = -1;
  }
  return new RRule(opts)
    .between(new Date(lo + "T00:00:00Z"), new Date(hi + "T23:59:59Z"), true)
    .map((d) => d.toISOString().slice(0, 10));
}
export function occurrences(state, from, to) {
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > DAY * 740
  )
    throw new Error("查询范围应为有效日期，且不超过两年");
  const out = [];
  for (const task of state.tasks.filter((t) => !t.deletedAt)) {
    const singleRecord =
      !task.repeat || task.repeat.kind === "none"
        ? state.occurrences.find((x) => x.taskId === task.id && !x.deletedAt)
        : null;
    const dates = new Set(
      singleRecord && task.date
        ? [singleRecord.originalDate]
        : ruleDates(task, from, to),
    );
    for (const x of state.occurrences.filter(
      (x) =>
        x.taskId === task.id && !x.deletedAt && x.date >= from && x.date <= to,
    ))
      dates.add(x.originalDate);
    for (const originalDate of dates) {
      const x = state.occurrences.find(
        (o) =>
          o.taskId === task.id &&
          o.originalDate === originalDate &&
          !o.deletedAt,
      );
      const d = x?.date || originalDate;
      if (d < from || d > to) continue;
      out.push({
        ...task,
        ...x,
        id: task.id,
        taskId: task.id,
        originalDate,
        date: d,
        status:
          x?.status ||
          (!task.repeat || task.repeat.kind === "none" ? task.status : "todo"),
        occurrenceId: x?.id || null,
      });
    }
  }
  return out.sort((a, b) =>
    (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")),
  );
}
export function habitRule(habit, date) {
  return [...habit.rules].reverse().find((r) => r.effective <= date) || null;
}
export function habitDue(habit, date) {
  const r = habitRule(habit, date);
  return (
    !!r && !r.paused && (r.mode === "weekly" || r.days.includes(weekday(date)))
  );
}
export function habitProgress(state, habit, date) {
  const r = habitRule(habit, date);
  if (!r) return { value: 0, target: 1, done: false };
  const logs = state.habitLogs.filter(
    (l) => l.habitId === habit.id && !l.deletedAt && l.date === date,
  );
  const value = logs.filter((l) => !l.skipped).reduce((s, l) => s + l.value, 0);
  return {
    value,
    target: r.mode === "quantity" ? r.target : 1,
    done: value >= (r.mode === "quantity" ? r.target : 1),
    skipped: logs.some((l) => l.skipped && !l.missed),
    missed: logs.some((l) => l.missed),
  };
}
