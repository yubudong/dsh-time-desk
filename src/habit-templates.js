// Optional starters. They only prefill the normal habit form; nothing is saved
// until the user confirms in the editor, and nothing schedules reminders.
export const HABIT_TEMPLATES = [
  {
    id: "reading",
    titleKey: "templateReading",
    noteKey: "templateReadingNote",
    mode: "daily",
    target: 1,
    unit: "次",
  },
  {
    id: "exercise",
    titleKey: "templateExercise",
    noteKey: "templateExerciseNote",
    mode: "daily",
    target: 30,
    unit: "分钟",
  },
  {
    id: "sleepEarly",
    titleKey: "templateSleep",
    noteKey: "templateSleepNote",
    mode: "daily",
    target: 1,
    unit: "次",
  },
  {
    id: "dailyReview",
    titleKey: "templateDailyReview",
    noteKey: "templateDailyReviewNote",
    mode: "daily",
    target: 1,
    unit: "次",
    reviewLinked: true,
  },
  {
    id: "weeklyReview",
    titleKey: "templateWeeklyReview",
    noteKey: "templateWeeklyReviewNote",
    mode: "weekly",
    target: 1,
    unit: "次",
  },
];
export function habitFromTemplate(template, effective, t) {
  return {
    title: t(template.titleKey),
    note: t(template.noteKey),
    reviewLinked: !!template.reviewLinked,
    plannedDates: [],
    rules: [
      {
        effective,
        mode: template.mode,
        days: [0, 1, 2, 3, 4, 5, 6],
        target: template.target,
        unit: template.unit,
        paused: false,
      },
    ],
  };
}
