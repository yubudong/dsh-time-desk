import { z } from "zod";
import { validDate } from "./dates.js";
import { HOME_MODULE_STORAGE_IDS } from "./home-modules.js";
const day = z.string().refine(validDate, "日期应为 YYYY-MM-DD");
const optionalDay = z.union([day, z.literal("")]).default("");
const str = (n = 200) => z.string().trim().max(n);
const clock = z
  .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal("")])
  .default("");
export const Repeat = z
  .object({
    kind: z
      .enum([
        "none",
        "daily",
        "weekly",
        "monthly",
        "yearly",
        "lunar",
        "completion",
      ])
      .default("none"),
    interval: z.number().int().min(1).max(365).default(1),
    days: z.array(z.number().int().min(0).max(6)).default([1]),
    until: optionalDay,
    monthMode: z.enum(["date", "lastWeekday"]).default("date"),
    missing: z.enum(["last", "skip"]).default("last"),
    month: z.number().int().min(1).max(12).default(1),
    day: z.number().int().min(1).max(30).default(1),
    leap: z.enum(["regular", "only", "both"]).default("regular"),
    leapFallback: z.enum(["skip", "regular"]).default("regular"),
    unit: z.enum(["days", "months", "years"]).default("months"),
  })
  .refine(
    (r) => r.kind !== "weekly" || r.days.length > 0,
    "请至少选择一个重复日",
  )
  .refine(
    (r) => r.kind !== "lunar" || r.interval === 1,
    "农历首版仅支持每年重复，间隔请设为 1",
  );
const meta = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().min(1),
  deletedAt: z.string().nullable().default(null),
};
export const ProjectInput = z.object({
  title: str().min(1),
  group: str(80).default(""),
  goal: str(5000).default(""),
  status: z.enum(["todo", "doing", "done", "paused"]).default("todo"),
  deadline: optionalDay,
});
export const TaskInput = z.object({
  title: str().min(1),
  area: z.enum(["work", "life", "inbox"]).default("inbox"),
  projectId: z.string().default(""),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  date: optionalDay,
  deadline: optionalDay,
  time: z
    .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal("")])
    .default(""),
  minutes: z.number().int().min(0).max(1440).default(0),
  pomodoros: z.number().int().min(0).max(100).default(0),
  note: str(10000).default(""),
  priorityDate: optionalDay,
  event: z.boolean().default(false),
  tag: str(60).default(""),
  reminderMinutes: z.number().int().min(0).max(527040).nullable().default(null),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("09:00"),
  repeat: Repeat.prefault({ kind: "none" }),
  steps: z
    .array(z.object({ id: z.string(), title: str().min(1), done: z.boolean() }))
    .max(100)
    .default([]),
});
export const LessonInput = z
  .object({
    title: str(200).min(1),
    participant: str(40).default(""),
    place: str(200).default(""),
    note: str(3000).default(""),
    mode: z.enum(["none", "credit", "term"]).default("none"),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .default([])
      .refine((v) => new Set(v).size === v.length, "同一天只能安排一次"),
    time: clock,
    weekdayTimes: z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          time: clock,
        }),
      )
      .max(7)
      .default([])
      .refine(
        (v) => new Set(v.map((x) => x.weekday)).size === v.length,
        "每个星期只能设置一个时间",
      ),
    durationMinutes: z.number().int().min(0).max(1440).default(60),
    effective: day,
    until: optionalDay,
    reminderMinutes: z
      .number()
      .int()
      .min(0)
      .max(10080)
      .nullable()
      .default(null),
    defaultDeduction: z.number().positive().max(1000).default(1),
    expiryWarnDays: z.number().int().min(0).max(365).nullable().default(30),
    scheduleHistory: z
      .array(
        z.object({
          from: day,
          weekdays: z.array(z.number().int().min(0).max(6)).max(7),
          time: clock,
          weekdayTimes: z
            .array(
              z.object({
                weekday: z.number().int().min(0).max(6),
                time: clock,
              }),
            )
            .max(7)
            .default([]),
          durationMinutes: z.number().int().min(0).max(1440),
          place: str(200),
          until: optionalDay,
          defaultDeduction: z.number().positive().max(1000),
        }),
      )
      .max(1000)
      .default([]),
    balanceWarnAt: z.number().int().min(0).max(1000).nullable().default(null),
  })
  .refine((v) => !v.until || v.until >= v.effective, "结束日期不能早于开始日期")
  .refine(
    (v) => v.weekdayTimes.every((x) => v.weekdays.includes(x.weekday)),
    "分星期时间必须对应已选择的星期",
  );
export const LessonTermInput = z
  .object({
    lessonId: z.string().min(1),
    start: day,
    end: day,
    purchased: z.number().int().min(0).max(100000).default(0),
    amount: z.number().min(0).max(1e9).nullable().default(null),
    note: str(3000).default(""),
  })
  .refine((v) => v.end >= v.start, "有效期结束不能早于开始");
export const LessonSessionInput = z.object({
  lessonId: z.string().min(1),
  originalDate: z.union([day, z.literal("")]).default(""),
  date: day,
  time: clock,
  place: str(200).default(""),
  status: z.enum(["scheduled", "done", "skipped"]).default("scheduled"),
  note: str(1000).default(""),
  deduction: z.number().min(0).max(1000).default(1),
  completedAt: z.string().nullable().default(null),
  durationMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  chargeId: z.string().default(""),
  changes: z
    .array(
      z.object({
        at: z.string(),
        action: z.string(),
        fromDate: day,
        date: day,
        fromTime: clock,
        time: clock,
        note: str(1000),
      }),
    )
    .max(10000)
    .default([]),
  extra: z.boolean().default(false),
});
export const LessonChargeInput = z.object({
  lessonId: z.string().min(1),
  date: day,
  delta: z.number().min(-100000).max(100000),
  kind: z
    .enum(["purchase", "gift", "opening", "use", "refund", "adjust"])
    .default("adjust"),
  amount: z.number().min(0).max(1e9).nullable().default(null),
  note: str(3000).default(""),
  sessionId: z.string().default(""),
  reversesId: z.string().default(""),
  expiresOn: optionalDay,
});
export const HomeModules = z
  .object({
    hidden: z.array(z.enum(HOME_MODULE_STORAGE_IDS)).max(50).default([]),
    order: z.array(z.enum(HOME_MODULE_STORAGE_IDS)).max(50).default([]),
    folded: z.array(z.enum(HOME_MODULE_STORAGE_IDS)).max(50).default([]),
  })
  .default({ hidden: [], order: [], folded: [] });
export const HabitRule = z
  .object({
    effective: day,
    mode: z.enum(["daily", "quantity", "duration", "weekly"]).default("daily"),
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .default([0, 1, 2, 3, 4, 5, 6]),
    target: z.number().positive().max(1000000).default(1),
    unit: str(20).default("次"),
    paused: z.boolean().default(false),
    allowNextDay: z.boolean().default(false),
    restDays: z.number().int().min(0).max(6).default(0),
    weeklyHints: z.boolean().default(true),
  })
  .refine(
    (r) =>
      r.mode !== "duration" || (Number.isInteger(r.target) && r.target <= 1440),
    "时间目标应为 1–1440 的整数分钟",
  )
  .refine(
    (r) => r.mode === "weekly" || r.restDays === 0,
    "休息间隔仅用于每周次数习惯",
  )
  .refine(
    (r) => r.mode !== "weekly" || (Number.isInteger(r.target) && r.target <= 7),
    "每周目标应为 1–7 个不同日期",
  );
export const HabitInput = z.object({
  title: str().min(1),
  note: str(3000).default(""),
  reviewLinked: z.boolean().default(false),
  plannedDates: z.array(day).max(5000).default([]),
  rules: z.array(HabitRule).min(1).max(1000),
});
export const Settings = z.object({
  timeZone: z
    .string()
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "时区无效")
    .default("Asia/Shanghai"),
  mood: z.enum(["daily", "bright", "focus", "calm"]).default("daily"),
  moodUntil: optionalDay,
  focusMinutes: z.number().int().min(1).max(180).default(25),
  timerFace: z
    .enum(["digital", "ring", "flip", "hourglass"])
    .default("digital"),
  displayBrightness: z.number().int().min(40).max(100).default(90),
  reduceMotion: z.boolean().default(false),
  shortBreak: z.number().int().min(1).max(60).default(5),
  longBreak: z.number().int().min(1).max(120).default(15),
  sound: z.boolean().default(false),
  notifications: z.boolean().default(false),
  reviewTemplate: str(2000).default(""),
  homeModules: HomeModules,
});
export const DayPlan = z.object({
  date: day,
  availableMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  selected: z
    .array(z.object({ taskId: z.string().min(1), originalDate: optionalDay }))
    .max(1000)
    .default([]),
});
export const State = z.object({
  schemaVersion: z.literal(1),
  dataEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  revision: z.number().int().min(0),
  deviceId: z.string(),
  settings: Settings,
  dayPlans: z.array(DayPlan).max(5000).default([]),
  lessons: z.array(LessonInput.extend(meta)).default([]),
  lessonTerms: z.array(LessonTermInput.extend(meta)).default([]),
  lessonSessions: z.array(LessonSessionInput.extend(meta)).default([]),
  lessonCharges: z.array(LessonChargeInput.extend(meta)).default([]),
  projects: z.array(ProjectInput.extend(meta)),
  tasks: z.array(TaskInput.extend(meta)),
  habits: z.array(HabitInput.extend(meta)),
  occurrences: z.array(
    z.object({
      ...meta,
      taskId: z.string(),
      originalDate: day,
      date: day,
      time: z.string().default(""),
      status: z
        .enum(["todo", "doing", "done", "skipped", "cancelled"])
        .default("todo"),
      completedAt: z.string().nullable().default(null),
    }),
  ),
  habitLogs: z.array(
    z.object({
      ...meta,
      habitId: z.string(),
      date: day,
      value: z.number().min(0).max(1000000),
      skipped: z.boolean(),
      missed: z.boolean().default(false),
      note: str(3000),
      completedAt: z.string().nullable().default(null),
      sourceReviewId: z.string().default(""),
    }),
  ),
  reviews: z.array(
    z.object({
      ...meta,
      date: day,
      kind: z.enum(["day", "week"]),
      text: str(20000),
      completedAt: z.string().nullable().default(null),
    }),
  ),
  focusLogs: z.array(
    z.object({
      ...meta,
      taskId: z.string(),
      originalDate: z.string(),
      title: str(),
      startedAt: z.string(),
      seconds: z.number().int().min(0).max(10800),
      completed: z.boolean(),
      date: day,
    }),
  ),
  timer: z
    .object({
      id: z.string(),
      phase: z.enum(["focus", "short", "long"]),
      status: z.enum(["running", "paused", "awaiting"]),
      taskId: z.string(),
      originalDate: z.string(),
      title: str(),
      startedAt: z.number(),
      segmentAt: z.number(),
      duration: z.number().min(60).max(10800),
      elapsed: z.number().min(0).max(10800),
      deadline: z.number(),
      round: z.number().int().min(0),
    })
    .nullable(),
  receipts: z
    .array(z.object({ key: z.string(), revision: z.number() }))
    .max(500),
  noticeAcks: z.array(z.string()).max(2000),
});
export const blankState = (deviceId) =>
  State.parse({
    schemaVersion: 1,
    revision: 0,
    deviceId,
    settings: {},
    projects: [],
    lessons: [],
    lessonTerms: [],
    lessonSessions: [],
    lessonCharges: [],
    tasks: [],
    habits: [],
    occurrences: [],
    habitLogs: [],
    reviews: [],
    focusLogs: [],
    timer: null,
    receipts: [],
    noticeAcks: [],
  });
export { day };
