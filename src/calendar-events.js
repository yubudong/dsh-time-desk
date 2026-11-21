import {
  occurrences,
  shift,
  habitRule,
  habitDue,
  habitProgress,
} from "./dates.js";
import { lessonOccurrences } from "./lessons.js";

// Presentation only: never write a check mark back into the task or habit title.
function present(event, completed) {
  return {
    ...event,
    title: (completed ? "✓ " : "") + event.title,
    classNames: [
      ...(event.classNames || []),
      ...(completed ? ["ld-event-done"] : []),
    ],
    extendedProps: {
      ...event.extendedProps,
      completionOrder: completed ? 1 : 0,
    },
  };
}
function endAt(date, time, minutes) {
  return time && minutes
    ? new Date(Date.parse(date + "T" + time + ":00Z") + minutes * 60000)
        .toISOString()
        .replace("Z", "")
    : undefined;
}
export function calendarEventOrder(view) {
  return view === "dayGridMonth"
    ? "completionOrder,start,-duration,allDay,title"
    : "start,-duration,allDay,completionOrder,title";
}
export function calendarEvents(state, from, to, filter = "all") {
  const events = [];
  if (!["habits", "lessons"].includes(filter))
    for (const x of occurrences(state, from, to)) {
      if (["cancelled", "skipped"].includes(x.status)) continue;
      if (filter !== "all" && x.area !== filter) continue;
      events.push(
        present(
          {
            id: x.id + "@" + x.originalDate,
            title: x.title,
            start: x.date + (x.time ? "T" + x.time : ""),
            end: endAt(x.date, x.time, x.minutes),
            allDay: !x.time,
            extendedProps: { source: x },
          },
          x.status === "done",
        ),
      );
    }
  if (filter === "all" || filter === "habits")
    for (let d = from; d <= to; d = shift(d, 1))
      for (const h of state.habits.filter((x) => !x.deletedAt)) {
        const rule = habitRule(h, d);
        if (rule?.mode === "weekly" || !habitDue(h, d)) continue;
        events.push(
          present(
            {
              id: "habit:" + h.id + "@" + d,
              title: h.title,
              allDay: true,
              start: d,
              editable: false,
              classNames: ["ld-event-habit"],
              extendedProps: { habit: h, date: d },
            },
            habitProgress(state, h, d).done,
          ),
        );
      }
  if (filter === "all" || filter === "lessons")
    for (const lesson of state.lessons.filter((x) => !x.deletedAt))
      for (const x of lessonOccurrences(state, lesson, from, to)) {
        if (x.status === "skipped") continue;
        events.push(
          present(
            {
              id: "lesson:" + x.key,
              title: x.title + (x.participant ? " · " + x.participant : ""),
              start: x.date + (x.time ? "T" + x.time : ""),
              end: endAt(x.date, x.time, x.durationMinutes),
              allDay: !x.time,
              classNames: ["ld-event-lesson"],
              extendedProps: { lesson: x },
            },
            x.status === "done",
          ),
        );
      }
  return events;
}
