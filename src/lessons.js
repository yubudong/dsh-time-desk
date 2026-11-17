import { shift, today, weekday, zonedStamp } from "./dates.js";
const live = (rows) => (rows || []).filter((x) => !x.deletedAt);
export const LESSON_MODES = ["none", "credit", "term"];
export const LESSON_STATUS = ["scheduled", "done", "skipped"];
const minutesOf = (time) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || ""))
    return time ? Number.NaN : 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
export const lessonTerms = (state, lessonId) =>
  live(state.lessonTerms).filter((x) => x.lessonId === lessonId);
export function lessonBounds(lesson, terms) {
  const own = live(terms).filter((x) => x.lessonId === lesson.id);
  if (lesson.mode === "term" && own.length)
    return own.map((x) => ({
      start: x.start > lesson.effective ? x.start : lesson.effective,
      end: x.end,
    }));
  return [{ start: lesson.effective, end: lesson.until || "" }];
}
const inBounds = (bounds, date) =>
  bounds.some((b) => date >= b.start && (!b.end || date <= b.end));
export function lessonTermAt(lesson, terms, date) {
  return (
    live(terms).find(
      (x) => x.lessonId === lesson.id && date >= x.start && date <= x.end,
    ) || null
  );
}
export function lessonTimeFor(lesson, date) {
  const per = (lesson.weekdayTimes || []).find(
    (x) => x.weekday === weekday(date) && x.time,
  );
  return per?.time || lesson.time;
}
function occurrenceOf(state, lesson, originalDate, row) {
  const base = {
    lessonId: lesson.id,
    title: lesson.title,
    participant: lesson.participant,
    originalDate,
    date: row?.date || originalDate,
    time: row?.time ?? lessonTimeFor(lesson, originalDate),
    durationMinutes: lesson.durationMinutes,
    place: row?.place ?? lesson.place,
    status: row?.status || "scheduled",
    note: row?.note || "",
    deduction: row?.deduction ?? lesson.defaultDeduction,
    completedAt: row?.completedAt ?? null,
    extra: !!row?.extra,
    movedFrom: row && row.date !== originalDate ? originalDate : "",
    sessionId: row?.id || "",
    key: lesson.id + "@" + (originalDate || "extra:" + (row?.id || "")),
  };
  return base;
}
/**
 * Scheduled lessons in [from, to]. Weekly rules supply the base; a stored
 * session with the same original date replaces it, so one move never adds a
 * second obligation. Extra rows exist on their own date only.
 */
export function lessonOccurrences(state, lesson, from, to) {
  if (lesson.deletedAt) return [];
  const rows = live(state.lessonSessions).filter(
    (x) => x.lessonId === lesson.id,
  );
  const byOriginal = new Map();
  for (const r of rows) if (r.originalDate) byOriginal.set(r.originalDate, r);
  const bounds = lessonBounds(lesson, state.lessonTerms);
  const out = [];
  const emitted = new Set();
  if (lesson.weekdays.length)
    for (let d = from; d <= to; d = shift(d, 1)) {
      if (!lesson.weekdays.includes(weekday(d)) || !inBounds(bounds, d))
        continue;
      const row = byOriginal.get(d);
      const date = row?.date || d;
      emitted.add((row?.originalDate || d) + ":" + date);
      if (date >= from && date <= to)
        out.push(occurrenceOf(state, lesson, d, row));
    }
  for (const r of rows) {
    if (!r.date || r.date < from || r.date > to) continue;
    if (emitted.has((r.originalDate || "") + ":" + r.date)) continue;
    out.push(occurrenceOf(state, lesson, r.originalDate || "", r));
  }
  return out.sort((a, b) =>
    (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")),
  );
}
export function lessonDone(state, lesson, from, to) {
  return lessonOccurrences(state, lesson, from, to).filter(
    (x) => x.status === "done",
  );
}
export function lessonAccount(state, lesson) {
  const rows = live(state.lessonCharges).filter(
    (x) => x.lessonId === lesson.id,
  );
  const sum = (f) => rows.filter(f).reduce((s, x) => s + x.delta, 0);
  return {
    balance: rows.reduce((s, x) => s + x.delta, 0),
    purchased: sum((x) => x.kind === "purchase"),
    gifted: sum((x) => x.kind === "gift"),
    opening: sum((x) => x.kind === "opening"),
    used: -sum((x) => x.kind === "use"),
    refunded: sum((x) => x.kind === "refund"),
    adjusted: sum((x) => x.kind === "adjust"),
    entries: rows.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    ),
  };
}
export function lessonSummary(state, lesson, date) {
  const terms = lessonTerms(state, lesson.id);
  const account =
    lesson.mode === "credit" ? lessonAccount(state, lesson) : null;
  const currentTerm =
    lesson.mode === "term"
      ? terms.find((x) => date >= x.start && date <= x.end) ||
        terms.find((x) => x.start > date) ||
        null
      : null;
  const termBounds = currentTerm
    ? { start: currentTerm.start, end: currentTerm.end }
    : lesson.mode === "term" && terms.length
      ? { start: terms.at(-1).start, end: terms.at(-1).end }
      : null;
  const stats =
    lesson.mode === "term" && termBounds
      ? lessonStats(state, lesson, termBounds.start, termBounds.end)
      : null;
  const expired =
    lesson.mode === "term" &&
    !!terms.length &&
    !terms.some((x) => x.end >= date);
  const endsIn =
    lesson.mode === "term" && currentTerm
      ? Math.round(
          (Date.parse(currentTerm.end + "T00:00:00Z") -
            Date.parse(date + "T00:00:00Z")) /
            86400000,
        )
      : null;
  return {
    account,
    currentTerm,
    terms,
    stats,
    expired,
    endsIn,
  };
}
export function lessonStats(state, lesson, from, to) {
  const done = lessonDone(state, lesson, from, to);
  return {
    sessions: done.length,
    units: done.reduce((s, x) => s + (Number(x.deduction) || 0), 0),
    skipped: lessonOccurrences(state, lesson, from, to).filter(
      (x) => x.status === "skipped",
    ).length,
    from,
    to,
  };
}
export function lessonConflict(
  state,
  lesson,
  date,
  time,
  durationMinutes,
  skipKey = "",
) {
  if (!time) return [];
  const start = minutesOf(time);
  if (!Number.isFinite(start)) return [];
  const end = start + Math.max(0, Number(durationMinutes) || 0);
  const who = (lesson.participant || "").trim();
  if (!who) return [];
  const out = [];
  for (const l of live(state.lessons)) {
    if (l.id === lesson.id) continue;
    if ((l.participant || "").trim() !== who) continue;
    for (const x of lessonOccurrences(state, l, date, date)) {
      if (x.date !== date || x.status === "skipped") continue;
      if (skipKey && x.key === skipKey) continue;
      const otherStart = minutesOf(x.time);
      if (!Number.isFinite(otherStart)) continue;
      const otherEnd = otherStart + Math.max(0, Number(x.durationMinutes) || 0);
      if (start < otherEnd && otherStart < end)
        out.push({
          key: x.key,
          lessonId: l.id,
          title: l.title,
          time: x.time,
          date: x.date,
        });
    }
  }
  return out;
}
export function lessonExpiring(state, date, withinDays = 30) {
  const limit = shift(date, withinDays);
  const out = [];
  for (const l of live(state.lessons)) {
    if (l.mode === "term")
      for (const term of lessonTerms(state, l.id))
        if (term.end >= date && term.end <= limit)
          out.push({
            kind: "term",
            lessonId: l.id,
            title: l.title,
            date: term.end,
            days: Math.round(
              (Date.parse(term.end + "T00:00:00Z") -
                Date.parse(date + "T00:00:00Z")) /
                86400000,
            ),
          });
    if (l.mode === "credit")
      for (const row of live(state.lessonCharges).filter(
        (x) => x.lessonId === l.id && x.expiresOn && x.delta > 0,
      ))
        if (row.expiresOn >= date && row.expiresOn <= limit)
          out.push({
            kind: "credit-expiry",
            lessonId: l.id,
            title: l.title,
            date: row.expiresOn,
            amount: row.delta,
            days: Math.round(
              (Date.parse(row.expiresOn + "T00:00:00Z") -
                Date.parse(date + "T00:00:00Z")) /
                86400000,
            ),
          });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export function lessonReminders(state, now, zone) {
  const date = today(zone, now);
  const out = [];
  for (const l of live(state.lessons)) {
    if (l.reminderMinutes === null || !l.time) continue;
    for (const x of lessonOccurrences(state, l, shift(date, -1), date)) {
      if (x.status !== "scheduled") continue;
      const stamp =
        zonedStamp(x.date, x.time, zone) - l.reminderMinutes * 60000;
      if (stamp > now || now - stamp > 12 * 60 * 60000) continue;
      out.push({
        key: "lesson:" + x.key + ":" + x.date + ":" + x.time + ":" + stamp,
        title: x.title + " · " + x.date + " " + lessonTimeLabel(l),
        at: stamp,
        date: x.date,
        time: x.time,
        lessonId: l.id,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
export function lessonTimeLabel(lesson) {
  if (!lesson.time) return "";
  const start = minutesOf(lesson.time);
  const end = start + (Number(lesson.durationMinutes) || 0);
  if (!Number.isFinite(end)) return lesson.time;
  return lesson.time + (lesson.durationMinutes ? "–" + fmtTime(end) : "");
}
function fmtTime(minutes) {
  const dayMinutes = ((minutes % 1440) + 1440) % 1440;
  return (
    String(Math.floor(dayMinutes / 60)).padStart(2, "0") +
    ":" +
    String(dayMinutes % 60).padStart(2, "0")
  );
}
export function lessonScheduleLabel(lesson, t) {
  if (!lesson.weekdays.length) return t("lessonOnce");
  return lesson.weekdays
    .slice()
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => t("weekdayShort" + d))
    .join(" · ");
}
export function lessonWeeklyLabel(lesson, t) {
  if (!lesson.weekdays.length)
    return t("lessonOnce") + (lesson.time ? " " + lesson.time : "");
  return lesson.weekdays
    .slice()
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => {
      const per = (lesson.weekdayTimes || []).find(
        (x) => x.weekday === d && x.time,
      );
      const time = per?.time || lesson.time;
      return t("weekdayShort" + d) + (time ? " " + time : "");
    })
    .join(" · ");
}
export function lessonRangeLabel(lesson, terms, t) {
  if (lesson.mode === "term") {
    const list = live(terms).filter((x) => x.lessonId === lesson.id);
    if (!list.length) return t("lessonNoTerm");
    const current =
      list.find((x) => today() <= x.end && today() >= x.start) || list.at(-1);
    return current.start + " – " + current.end;
  }
  return lesson.effective + (lesson.until ? " – " + lesson.until : "");
}
