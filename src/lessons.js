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
  live(state.lessonTerms)
    .filter((x) => x.lessonId === lessonId)
    .sort((a, b) => a.start.localeCompare(b.start));
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
export function lessonScheduleAt(lesson, date) {
  if (date < lesson.effective) return null;
  const history = lesson.scheduleHistory || [];
  return history.length
    ? [...history].reverse().find((x) => x.from <= date) || null
    : { ...lesson, from: lesson.effective };
}
export function lessonTimeFor(lesson, date) {
  const rule = lessonScheduleAt(lesson, date);
  const per = (rule?.weekdayTimes || []).find(
    (x) => x.weekday === weekday(date) && x.time,
  );
  return per?.time ?? rule?.time ?? "";
}
export function lessonDue(lesson, date, terms) {
  const r = lessonScheduleAt(lesson, date);
  if (!r || (r.until && date > r.until)) return false;
  if (!inBounds(lessonBounds(lesson, terms), date)) return false;
  return r.weekdays.length
    ? r.weekdays.includes(weekday(date))
    : date === r.from;
}
function occurrenceOf(state, lesson, originalDate, row) {
  const date = row?.date || originalDate;
  const rule = lessonScheduleAt(lesson, originalDate || date) || lesson;
  return {
    lessonId: lesson.id,
    title: lesson.title,
    participant: lesson.participant,
    originalDate,
    date,
    time: row?.time ?? lessonTimeFor(lesson, originalDate || date),
    durationMinutes: row?.durationMinutes ?? rule.durationMinutes,
    place: row?.place ?? rule.place,
    status: row?.status || "scheduled",
    note: row?.note || "",
    deduction: row?.deduction ?? rule.defaultDeduction,
    completedAt: row?.completedAt ?? null,
    extra: !!row?.extra,
    movedFrom:
      row && originalDate && row.date !== originalDate ? originalDate : "",
    sessionId: row?.id || "",
    version: row?.version || 0,
    changes: row?.changes || [],
    charged: !!row && !!activeLessonUsage(state, row),
    key: lesson.id + "@" + (originalDate || "extra:" + (row?.id || "")),
  };
}
/** Resolve each original session once; explicit rows survive later schedule changes. */
export function lessonOccurrences(state, lesson, from, to) {
  if (lesson.deletedAt) return [];
  const rows = live(state.lessonSessions).filter(
    (x) => x.lessonId === lesson.id,
  );
  const byOriginal = new Map(
    rows.filter((x) => x.originalDate).map((x) => [x.originalDate, x]),
  );
  const out = [],
    emitted = new Set();
  for (let d = from; d <= to; d = shift(d, 1)) {
    if (!lessonDue(lesson, d, state.lessonTerms)) continue;
    const row = byOriginal.get(d),
      x = occurrenceOf(state, lesson, d, row);
    if (row) emitted.add(row.id);
    if (x.date >= from && x.date <= to) out.push(x);
  }
  for (const row of rows) {
    if (row.date < from || row.date > to || emitted.has(row.id)) continue;
    out.push(occurrenceOf(state, lesson, row.originalDate || "", row));
  }
  return out.sort(
    (a, b) =>
      (a.date + (a.time || "99:99")).localeCompare(
        b.date + (b.time || "99:99"),
      ) || a.key.localeCompare(b.key),
  );
}
export const sumCredits = (values) =>
  values.reduce((s, n) => s + Math.round(n * 1000000), 0) / 1000000;
/** Legacy refunds cancel the immediately preceding use, without rewriting old money. */
export function activeLessonUsage(state, session) {
  const stack = [];
  for (const row of live(state.lessonCharges).filter(
    (x) => x.sessionId === session.id,
  )) {
    if (row.kind === "use") stack.push(row);
    if (row.kind === "refund") {
      const i = row.reversesId
        ? stack.findIndex((x) => x.id === row.reversesId)
        : stack.length - 1;
      if (i >= 0) stack.splice(i, 1);
    }
  }
  return stack.at(-1) || null;
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
  const sum = (f) => sumCredits(rows.filter(f).map((x) => x.delta));
  return {
    balance: sumCredits(rows.map((x) => x.delta)),
    purchased: sum((x) => x.kind === "purchase"),
    gifted: sum((x) => x.kind === "gift"),
    opening: sum((x) => x.kind === "opening"),
    used: -sum((x) => x.kind === "use"),
    refunded: sum((x) => x.kind === "refund"),
    netUsed: -sum((x) => x.kind === "use" || x.kind === "refund"),
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
    termStatus: currentTerm
      ? currentTerm.start > date
        ? "upcoming"
        : "active"
      : expired
        ? "expired"
        : "none",
  };
}
export function lessonStats(state, lesson, from, to) {
  const done = lessonDone(state, lesson, from, to);
  return {
    sessions: done.length,
    units: sumCredits(done.map((x) => Number(x.deduction) || 0)),
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
  const start = Date.parse(date + "T00:00:00Z") / 60000 + minutesOf(time);
  if (!Number.isFinite(start)) return [];
  const end = start + Math.max(0, Number(durationMinutes) || 0),
    who = (lesson.participant || "").trim(),
    out = [];
  for (const l of live(state.lessons)) {
    if (l.id !== lesson.id && (!who || (l.participant || "").trim() !== who))
      continue;
    for (const x of lessonOccurrences(
      state,
      l,
      shift(date, -1),
      shift(date, 1),
    )) {
      if (x.status === "skipped" || x.key === skipKey || !x.time) continue;
      const a = Date.parse(x.date + "T00:00:00Z") / 60000 + minutesOf(x.time);
      if (start < a + x.durationMinutes && a < end)
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
export function lessonExpiring(state, date, withinDays) {
  const out = [];
  for (const l of live(state.lessons)) {
    if (l.expiryWarnDays === null) continue;
    const threshold = l.expiryWarnDays ?? 30;
    const effectiveLimit = shift(
      date,
      Math.min(withinDays ?? threshold, threshold),
    );
    if (l.mode === "term")
      for (const term of lessonTerms(state, l.id))
        if (term.end >= date && term.end <= effectiveLimit)
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
        if (row.expiresOn >= date && row.expiresOn <= effectiveLimit)
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
  const date = today(zone, now),
    out = [];
  for (const l of live(state.lessons)) {
    if (l.reminderMinutes == null) continue;
    const lead = Math.ceil(l.reminderMinutes / 1440) + 1;
    for (const x of lessonOccurrences(
      state,
      l,
      shift(date, -1),
      shift(date, lead),
    )) {
      if (x.status !== "scheduled" || !x.time) continue;
      try {
        const at = zonedStamp(x.date, x.time, zone) - l.reminderMinutes * 60000;
        if (at > now || now - at > 12 * 60 * 60000) continue;
        out.push({
          key: "lesson:" + x.key + ":" + x.date + ":" + x.time + ":" + at,
          title: x.title + " · " + x.date + " " + lessonTimeLabel(x),
          at,
          date: x.date,
          time: x.time,
          lessonId: l.id,
        });
      } catch {
        /* A nonexistent local time must not suppress other lessons. */
      }
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

export function lessonScheduleSignature(lesson) {
  return JSON.stringify({
    weekdays: [...(lesson.weekdays || [])].sort((a, b) => a - b),
    weekdayTimes: [...(lesson.weekdayTimes || [])]
      .filter((x) => x.time)
      .sort((a, b) => a.weekday - b.weekday),
    time: lesson.time || "",
    durationMinutes: lesson.durationMinutes,
    place: lesson.place || "",
    until: lesson.until || "",
    defaultDeduction: lesson.defaultDeduction,
  });
}
