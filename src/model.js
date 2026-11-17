import { hasReviewContent, normalizeTemplate } from "./review-template.js";
import { randomUUID } from "node:crypto";
import { durationSeconds } from "./focus-state.js";
import { dailyPlan, planKey, inboxTasks } from "./planning.js";
import {
  State,
  blankState,
  ProjectInput,
  TaskInput,
  HabitInput,
  Settings,
  LessonInput,
  LessonTermInput,
  LessonSessionInput,
  LessonChargeInput,
  day,
} from "./schema.js";
import {
  lessonAccount,
  lessonBounds,
  lessonConflict,
  lessonTermAt,
  lessonTerms,
} from "./lessons.js";
import {
  occurrences,
  today,
  shift,
  habitDue,
  habitRule,
  habitProgress,
  ruleDates,
  zonedStamp,
  weekday,
} from "./dates.js";
const fail = (m) => {
  throw new Error(m);
};
const nowMeta = (now) => ({
  id: randomUUID(),
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  version: 1,
  deletedAt: null,
});
const live = (s, c, id) =>
  s[c]?.find((x) => x.id === id && !x.deletedAt) || fail("记录不存在或已删除");
function validateTask(s, t) {
  if (t.projectId && !s.projects.some((p) => p.id === t.projectId))
    fail("关联项目不存在");
  if (t.time && !t.date) fail("设置时刻前请选择日期");
  if (t.repeat.kind !== "none" && !t.date) fail("重复事项需要开始日期");
  if (t.repeat.until && t.repeat.until < t.date)
    fail("结束日期不能早于开始日期");
  if (t.time) zonedStamp(t.date, t.time, s.settings.timeZone);
  if (t.repeat.kind === "completion" && t.event) fail("完成后重复只适用于待办");
  if (
    t.priorityDate &&
    s.tasks.filter(
      (x) => !x.deletedAt && x.id !== t.id && x.priorityDate === t.priorityDate,
    ).length >= 3
  )
    fail("每天最多三件重点");
}
function stamp(record, now) {
  record.updatedAt = new Date(now).toISOString();
  record.version++;
  return record;
}
export function timerSeconds(timer, now) {
  return Math.min(
    timer.duration,
    Math.max(
      0,
      timer.elapsed +
        (timer.status === "running" ? (now - timer.segmentAt) / 1000 : 0),
    ),
  );
}
function upsertTerm(s, lesson, input, now, iso, explicitId) {
  const id = explicitId || input?.id || "";
  const existing = id ? live(s, "lessonTerms", id) : null;
  if (existing && existing.lessonId !== lesson.id) fail("有效期不属于该课程");
  const data = LessonTermInput.parse({
    ...existing,
    ...input,
    id: existing?.id,
    lessonId: lesson.id,
  });
  if (
    s.lessonTerms.some(
      (x) =>
        !x.deletedAt &&
        x.lessonId === lesson.id &&
        x.id !== existing?.id &&
        x.start <= data.end &&
        data.start <= x.end,
    )
  )
    fail("有效期与已有周期重叠");
  if (existing) {
    const outside = s.lessonSessions.some(
      (x) =>
        !x.deletedAt &&
        x.lessonId === lesson.id &&
        x.status === "done" &&
        (x.date < data.start || x.date > data.end),
    );
    if (outside) fail("有效期不能排除已上课记录，请先核对历史");
    const record = stamp({ ...existing, ...data }, now);
    s.lessonTerms[s.lessonTerms.indexOf(existing)] = record;
    return record;
  }
  const record = {
    ...data,
    ...nowMeta(now),
    createdAt: iso,
    updatedAt: iso,
  };
  s.lessonTerms.push(record);
  return record;
}
export function applyAction(current, a, now = Date.now()) {
  const s = structuredClone(current);
  const iso = new Date(now).toISOString();
  const localDay = today(s.settings.timeZone, now);
  if (!a || typeof a !== "object") fail("请求无效");
  if (a.action === "read") return s;
  if (a.requestId && s.receipts.some((r) => r.key === a.requestId)) return s;
  if (a.revision !== s.revision) fail("数据已更新，请刷新后重新操作");
  const collection = a.collection;
  if (a.action === "plan") {
    const date = day.parse(a.date);
    const index = s.dayPlans.findIndex((p) => p.date === date);
    const plan =
      index < 0
        ? { date, availableMinutes: null, selected: [] }
        : s.dayPlans[index];
    if (a.command === "capacity") {
      if (!a.item || !Object.hasOwn(a.item, "availableMinutes"))
        fail("请明确提供可用分钟，或 null 清除设置");
      plan.availableMinutes = a.item.availableMinutes;
    } else if (["pick", "unpick"].includes(a.command)) {
      const task = live(s, "tasks", a.id);
      const groups = dailyPlan(s, date);
      const candidates = [
        ...groups.backlog,
        ...groups.todos.filter((x) => x.carriedFrom),
      ];
      const instance = candidates.find(
        (x) =>
          x.id === task.id &&
          (!a.originalDate || x.originalDate === a.originalDate),
      );
      if (!instance) fail("只能选择该日可执行的延续待办，请刷新后重试");
      const key = planKey(instance);
      plan.selected = plan.selected.filter(
        (x) => x.taskId + "@" + x.originalDate !== key,
      );
      if (a.command === "pick")
        plan.selected.push({
          taskId: task.id,
          originalDate: instance.originalDate || instance.date || "",
        });
    } else fail("计划操作无效");
    if (index < 0) s.dayPlans.push(plan);
    else s.dayPlans[index] = plan;
  } else if (a.action === "save") {
    if (!["projects", "tasks", "habits"].includes(collection))
      fail("不支持的记录类型");
    const old = a.id ? live(s, collection, a.id) : null;
    if (old && a.version !== undefined && old.version !== a.version)
      fail("这条记录已被修改，请重新读取");
    const schema = {
      projects: ProjectInput,
      tasks: TaskInput,
      habits: HabitInput,
    }[collection];
    const data = schema.parse({ ...old, ...a.item });
    if (collection === "habits") {
      data.rules.sort((a, b) => a.effective.localeCompare(b.effective));
      if (
        new Set(data.rules.map((r) => r.effective)).size !== data.rules.length
      )
        fail("同一天只能设置一条习惯规则");
      for (const r of data.rules)
        if (
          r.mode === "weekly" &&
          (!Number.isInteger(r.target) || r.target > 7)
        )
          fail("每周目标应为 1–7 天");
      if (old) {
        for (const r of old.rules.filter((r) => r.effective < localDay)) {
          if (!data.rules.some((x) => JSON.stringify(x) === JSON.stringify(r)))
            fail("过去的习惯规则应保留，请添加今天或以后的新规则");
        }
      }
    }
    const record = {
      ...data,
      ...(old
        ? {
            id: old.id,
            createdAt: old.createdAt,
            updatedAt: iso,
            version: old.version + 1,
            deletedAt: null,
          }
        : nowMeta(now)),
    };
    if (collection === "tasks") {
      if (
        old &&
        old.repeat.kind !== "none" &&
        s.occurrences.some((x) => x.taskId === old.id && !x.deletedAt) &&
        JSON.stringify([old.date, old.repeat]) !==
          JSON.stringify([record.date, record.repeat])
      )
        fail("已有历史的重复事项请用“这次及以后”修改");
      validateTask(s, record);
      if (old && old.repeat.kind === "none" && record.repeat.kind === "none")
        for (const x of s.occurrences.filter(
          (x) => x.taskId === old.id && !x.deletedAt,
        )) {
          if (!record.date) x.deletedAt = iso;
          else {
            if (record.date !== old.date) x.date = record.date;
            if (record.time !== old.time) x.time = record.time;
            if (record.status !== old.status) {
              x.status = record.status;
              x.completedAt =
                record.status === "done" ? x.completedAt || iso : null;
            }
          }
          stamp(x, now);
        }
    }
    if (old)
      s[collection][s[collection].findIndex((x) => x.id === old.id)] = record;
    else s[collection].push(record);
  } else if (a.action === "trash" || a.action === "restore") {
    if (
      ![
        "projects",
        "tasks",
        "habits",
        "lessons",
        "reviews",
        "focusLogs",
      ].includes(collection)
    )
      fail("不支持的记录类型");
    const x = s[collection].find((x) => x.id === a.id) || fail("记录不存在");
    if (a.action === "restore" && collection === "tasks") validateTask(s, x);
    x.deletedAt = a.action === "trash" ? iso : null;
    stamp(x, now);
  } else if (a.action === "occurrence") {
    const t = live(s, "tasks", a.id);
    const originalDate = day.parse(a.originalDate);
    const existing = s.occurrences.find(
      (x) =>
        x.taskId === t.id && x.originalDate === originalDate && !x.deletedAt,
    );
    if (!existing && !ruleDates(t, originalDate, originalDate).length)
      fail("这一天不属于该事项");
    const date = day.parse(a.date || existing?.date || originalDate);
    const status = a.status || existing?.status || "todo";
    if (!["todo", "doing", "done", "skipped", "cancelled"].includes(status))
      fail("状态无效");
    if (
      t.repeat.kind === "completion" &&
      existing?.status === "done" &&
      status !== "done"
    )
      fail("完成后重复的历史不能直接重开，请撤销上次操作或新建待办");
    const time = a.time === undefined ? (existing?.time ?? t.time) : a.time;
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("时刻无效");
    const x = {
      ...(existing || nowMeta(now)),
      taskId: t.id,
      originalDate,
      date,
      time,
      status,
      completedAt: status === "done" ? iso : null,
    };
    if (existing) {
      stamp(x, now);
      s.occurrences[s.occurrences.indexOf(existing)] = x;
    } else s.occurrences.push(x);
    if (t.repeat.kind === "none") {
      t.status =
        status === "done" ? "done" : status === "doing" ? "doing" : "todo";
      stamp(t, now);
    }
    if (t.repeat.kind === "completion" && status === "done") {
      if (existing?.status === "done") fail("该次已完成");
      const n = t.repeat.interval;
      const d = new Date(localDay + "T00:00:00Z");
      if (t.repeat.unit === "days") t.date = shift(localDay, n);
      else {
        const desired = d.getUTCDate();
        d.setUTCDate(1);
        if (t.repeat.unit === "months") d.setUTCMonth(d.getUTCMonth() + n);
        else d.setUTCFullYear(d.getUTCFullYear() + n);
        const last = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
        ).getUTCDate();
        d.setUTCDate(Math.min(desired, last));
        t.date = d.toISOString().slice(0, 10);
      }
      stamp(t, now);
    }
  } else if (a.action === "splitSeries") {
    const t = live(s, "tasks", a.id);
    if (t.repeat.kind === "none" || t.repeat.kind === "completion")
      fail("该事项不支持拆分");
    const split = day.parse(a.originalDate);
    if (!ruleDates(t, split, split).length) fail("请选择原始发生日期");
    if (
      s.occurrences.some(
        (x) =>
          x.taskId === t.id &&
          !x.deletedAt &&
          x.originalDate >= split &&
          x.status === "done",
      )
    )
      fail("拆分范围包含已完成记录，请选择最后一次完成之后的日期");
    const data = TaskInput.parse({ ...t, ...a.item, priorityDate: "" });
    const newTask = { ...data, ...nowMeta(now) };
    validateTask(s, newTask);
    t.repeat.until = shift(split, -1);
    stamp(t, now);
    s.tasks.push(newTask);
    // Keep completed historical records on original series; future exceptions transfer once.
    for (const x of s.occurrences.filter(
      (x) => x.taskId === t.id && x.originalDate >= split && !x.deletedAt,
    )) {
      if (x.status === "done") continue;
      x.deletedAt = iso;
      stamp(x, now);
    }
  } else if (a.action === "habitLog") {
    const h = live(s, "habits", a.id);
    const date = day.parse(a.date || localDay);
    if (a.status === "planned" || a.status === "unplanned") {
      if (!habitDue(h, date) || habitRule(h, date)?.mode !== "weekly")
        fail("只能安排有效的每周次数习惯");
      h.plannedDates = [
        ...new Set([
          ...(h.plannedDates || []).filter((d) => d !== date),
          ...(a.status === "planned" ? [date] : []),
        ]),
      ].sort();
      stamp(h, now);
      s.revision++;
      if (a.requestId)
        s.receipts = [
          ...s.receipts,
          { key: String(a.requestId), revision: s.revision },
        ].slice(-500);
      return State.parse(s);
    }
    if (a.status === "missed") a = { ...a, skipped: true };
    if (date > localDay) fail("不能提前打卡");
    if (!habitDue(h, date)) fail("该日未安排此习惯或已暂停");
    if (a.removeId) {
      const l = live(s, "habitLogs", a.removeId);
      if (l.habitId !== h.id || l.date !== date) fail("记录不匹配");
      l.deletedAt = iso;
      stamp(l, now);
    } else {
      if (h.reviewLinked && habitRule(h, date)?.mode === "daily" && !a.skipped)
        fail("此习惯需要保存日复盘内容后完成，请使用 review 操作");
      const value = Number(a.value ?? 1);
      const rule = habitRule(h, date);
      const measured = ["quantity", "duration"].includes(rule.mode);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > (rule.mode === "duration" ? 1440 : 1000000) ||
        (rule.mode === "duration" && !Number.isInteger(value))
      )
        fail(
          rule.mode === "duration"
            ? "本次分钟应为 1–1440 的整数"
            : "数量应为 0–1000000",
        );
      const logs = s.habitLogs.filter(
        (x) => !x.deletedAt && x.habitId === h.id && x.date === date,
      );
      if (
        !measured &&
        !a.skipped &&
        logs.some((x) => !x.skipped && x.value > 0)
      )
        fail("当天已打卡，可先撤销再修改");
      if (logs.some((x) => x.skipped) && !a.skipped)
        for (const l of logs.filter((x) => x.skipped)) {
          l.deletedAt = iso;
          stamp(l, now);
        }
      if (a.skipped && habitProgress(s, h, date).done)
        fail("当天已达成，请先撤销完成记录再标记跳过或未达成");
      if (a.skipped)
        for (const l of logs.filter((x) => x.skipped)) {
          l.deletedAt = iso;
          stamp(l, now);
        }
      s.habitLogs.push({
        ...nowMeta(now),
        habitId: h.id,
        date,
        value: a.skipped ? 0 : value,
        skipped: !!a.skipped,
        missed: a.status === "missed",
        note: String(a.note || "").slice(0, 3000),
      });
    }
  } else if (a.action === "review") {
    const date = day.parse(a.date);
    if (!["day", "week"].includes(a.kind)) fail("复盘类型无效");
    if (date > localDay) fail("不能提前完成未来的复盘");
    const text = String(a.text || "");
    if (text.length > 20000) fail("复盘最多 20000 字");
    if (!hasReviewContent(text, s.settings.reviewTemplate))
      fail("请写入复盘内容，空白或只有模板问题不能完成复盘");
    const old = s.reviews.find(
      (x) => x.date === date && x.kind === a.kind && !x.deletedAt,
    );
    if (a.version !== undefined && a.version !== (old?.version || 0))
      fail("该日复盘已被修改，草稿已保留，请重新读取后核对");
    if (a.id) {
      const h = live(s, "habits", a.id);
      if (
        !h.reviewLinked ||
        !habitDue(h, date) ||
        habitRule(h, date)?.mode !== "daily"
      )
        fail("该日习惯不关联日复盘");
      const progress = habitProgress(s, h, date, now);
      if (progress.skipped || progress.missed)
        fail("该日已标记跳过或未达成，请先撤销该标记，再保存复盘");
    }
    let review = old;
    if (old) {
      old.completedAt ||= old.text.trim() ? old.createdAt : iso;
      old.text = text;
      stamp(old, now);
    } else {
      review = { ...nowMeta(now), date, kind: a.kind, text, completedAt: iso };
      s.reviews.push(review);
    }
    if (a.kind === "day")
      for (const h of s.habits.filter(
        (h) =>
          !h.deletedAt &&
          h.reviewLinked &&
          habitDue(h, date) &&
          habitRule(h, date)?.mode === "daily",
      )) {
        const progress = habitProgress(s, h, date, now);
        if (!progress.done && !progress.skipped && !progress.missed)
          s.habitLogs.push({
            ...nowMeta(now),
            habitId: h.id,
            date,
            value: 1,
            skipped: false,
            missed: false,
            note: "关联复盘",
            completedAt: review.completedAt,
            sourceReviewId: review.id,
          });
      }
  } else if (a.action === "lesson") {
    const old = a.id ? live(s, "lessons", a.id) : null;
    if (old && a.version !== undefined && old.version !== a.version)
      fail("这条课程已被修改，请重新读取");
    const data = LessonInput.parse({ ...old, ...a.item });
    data.weekdays = [...new Set(data.weekdays)].sort((x, y) => x - y);
    const record = {
      ...data,
      ...(old
        ? {
            id: old.id,
            createdAt: old.createdAt,
            updatedAt: iso,
            version: old.version + 1,
            deletedAt: null,
          }
        : nowMeta(now)),
    };
    if (old) s.lessons[s.lessons.findIndex((x) => x.id === old.id)] = record;
    else s.lessons.push(record);
    if (a.term) upsertTerm(s, record, a.term, now, iso);
    if (record.mode === "term" && !lessonTerms(s, record.id).length)
      fail("期限课程需要填写有效期");
  } else if (a.action === "lessonTerm") {
    const lesson = live(s, "lessons", a.id);
    if (lesson.mode !== "term") fail("只有期限课程可以设置有效期");
    if (a.command === "remove") {
      const term = live(s, "lessonTerms", a.removeId);
      if (term.lessonId !== lesson.id) fail("有效期不属于该课程");
      const used = s.lessonSessions.some(
        (x) =>
          !x.deletedAt &&
          x.lessonId === lesson.id &&
          x.status === "done" &&
          x.date >= term.start &&
          x.date <= term.end,
      );
      if (used) fail("该有效期已有上课记录，不能删除");
      term.deletedAt = iso;
      stamp(term, now);
    } else {
      const list = lessonTerms(s, lesson.id);
      const last = list.at(-1);
      const base =
        a.command === "renew" && last
          ? {
              start: shift(last.end, 1),
              purchased: last.purchased,
              amount: last.amount,
              note: "",
            }
          : {};
      upsertTerm(s, lesson, { ...base, ...a.item }, now, iso, a.item?.id);
    }
  } else if (a.action === "lessonSession") {
    const lesson = live(s, "lessons", a.id);
    const originalDate = a.originalDate ? day.parse(a.originalDate) : "";
    const existing = a.sessionId
      ? live(s, "lessonSessions", a.sessionId)
      : originalDate
        ? s.lessonSessions.find(
            (x) =>
              x.lessonId === lesson.id &&
              x.originalDate === originalDate &&
              !x.deletedAt,
          ) || null
        : null;
    if (existing && existing.lessonId !== lesson.id) fail("记录不属于该课程");
    const termDate = (date) => {
      if (lesson.mode !== "term") return;
      if (!lessonTermAt(lesson, s.lessonTerms, date))
        fail("该日期不在有效期内，请先调整有效期或续费");
    };
    const upsert = (patch) => {
      const row = {
        ...(existing || nowMeta(now)),
        lessonId: lesson.id,
        originalDate:
          patch.originalDate !== undefined
            ? patch.originalDate
            : (existing?.originalDate ?? originalDate),
        date: patch.date ?? existing?.date ?? originalDate,
        time: patch.time ?? existing?.time ?? lesson.time,
        place: patch.place ?? existing?.place ?? lesson.place,
        status: patch.status ?? existing?.status ?? "scheduled",
        note: patch.note ?? existing?.note ?? "",
        deduction:
          patch.deduction ?? existing?.deduction ?? lesson.defaultDeduction,
        completedAt: patch.completedAt ?? existing?.completedAt ?? null,
        extra: patch.extra ?? existing?.extra ?? false,
      };
      LessonSessionInput.parse(row);
      if (existing)
        s.lessonSessions[s.lessonSessions.indexOf(existing)] = stamp(row, now);
      else s.lessonSessions.push(stamp(row, now));
      return row;
    };
    if (a.command === "add") {
      const date = day.parse(a.date);
      termDate(date);
      const time = a.time ?? lesson.time;
      const conflicts = lessonConflict(
        s,
        lesson,
        date,
        time,
        lesson.durationMinutes,
      );
      if (conflicts.length && a.confirmConflict !== true)
        fail(
          "与 " +
            conflicts.map((x) => x.title).join("、") +
            " 时间重叠，确认后仍可保存",
        );
      upsert({
        originalDate: "",
        date,
        time,
        place: a.place ?? lesson.place,
        note: a.note || "",
        status: "scheduled",
        extra: true,
      });
    } else if (a.command === "restore") {
      if (!existing) fail("这一节没有被调整");
      if (existing.status === "done") fail("已上课的记录请先撤销再恢复安排");
      if (existing.extra) {
        existing.deletedAt = iso;
        stamp(existing, now);
      } else {
        const restored = {
          ...existing,
          date: existing.originalDate,
          time: lesson.time,
          place: lesson.place,
          note: "",
        };
        LessonSessionInput.parse(restored);
        s.lessonSessions[s.lessonSessions.indexOf(existing)] = stamp(
          restored,
          now,
        );
      }
    } else if (a.command === "skip") {
      if (!existing && !originalDate) fail("请指定要请假的课程");
      if (existing?.status === "done") fail("已上课的记录请先撤销再请假");
      const date = existing?.date || originalDate;
      termDate(date);
      const base =
        !!originalDate &&
        lesson.weekdays.includes(weekday(originalDate)) &&
        lessonBounds(lesson, s.lessonTerms).some(
          (b) => originalDate >= b.start && (!b.end || originalDate <= b.end),
        );
      if (!existing && !base) fail("该日期不属于课程安排，请使用临时加课");
      upsert({ status: "skipped", completedAt: null, note: a.note || "" });
    } else if (a.command === "complete") {
      const rowDate = existing?.date || originalDate;
      if (!rowDate) fail("请指定上课日期");
      if (existing?.status === "done") fail("这一节已经记录上课");
      termDate(rowDate);
      if (!existing) {
        const base =
          !!originalDate &&
          lesson.weekdays.includes(weekday(originalDate)) &&
          lessonBounds(lesson, s.lessonTerms).some(
            (b) => originalDate >= b.start && (!b.end || originalDate <= b.end),
          );
        if (!base) fail("该日期不属于课程安排，请使用临时加课");
      }
      const deduction = Number(
        a.deduction ?? existing?.deduction ?? lesson.defaultDeduction,
      );
      if (!Number.isFinite(deduction) || deduction < 0 || deduction > 1000)
        fail("本次扣除课时应在 0–1000");
      if (lesson.mode === "credit" && deduction > 0) {
        const balance = lessonAccount(s, lesson).balance;
        if (balance < deduction && a.confirmShort !== true)
          fail(
            "课时不足：剩余 " +
              balance +
              "，本次需要 " +
              deduction +
              "。如已上课，请确认后再记录。",
          );
      }
      const row = upsert({
        status: "done",
        date: rowDate,
        completedAt: iso,
        deduction,
        note: a.note || "",
      });
      if (lesson.mode === "credit" && deduction > 0)
        s.lessonCharges.push({
          ...nowMeta(now),
          lessonId: lesson.id,
          date: rowDate,
          delta: -deduction,
          kind: "use",
          amount: null,
          note: "上课",
          sessionId: row.id,
          expiresOn: "",
        });
    } else if (a.command === "undo") {
      if (!existing || existing.status !== "done")
        fail("只有已上课的记录可以撤销");
      const refund = existing.deduction;
      existing.status = "scheduled";
      existing.completedAt = null;
      stamp(existing, now);
      if (lesson.mode === "credit" && refund > 0) {
        const used = s.lessonCharges.find(
          (x) =>
            !x.deletedAt &&
            x.lessonId === lesson.id &&
            x.sessionId === existing.id &&
            x.kind === "use",
        );
        if (used)
          s.lessonCharges.push({
            ...nowMeta(now),
            lessonId: lesson.id,
            date: existing.date,
            delta: Math.abs(used.delta),
            kind: "refund",
            amount: null,
            note: "撤销上课记录",
            sessionId: existing.id,
            expiresOn: "",
          });
      }
    } else if (a.command === "remove") {
      if (!existing?.extra) fail("只有临时增加的课程可以删除");
      if (existing.status === "done") fail("已上课的记录请先撤销再删除");
      existing.deletedAt = iso;
      stamp(existing, now);
    } else if (a.command === "save") {
      const date = day.parse(a.date || existing?.date || originalDate);
      if (!date) fail("请选择调整后的日期");
      if (!originalDate && !existing?.extra) fail("请指定原定日期");
      if (existing?.status === "done") fail("已上课的记录请先撤销再调课");
      if (!existing) {
        const baseExists =
          !!originalDate &&
          lesson.weekdays.includes(weekday(originalDate)) &&
          lessonBounds(lesson, s.lessonTerms).some(
            (b) => originalDate >= b.start && (!b.end || originalDate <= b.end),
          );
        if (!baseExists) fail("该日期不属于课程安排");
      }
      termDate(date);
      const time = a.time ?? existing?.time ?? lesson.time;
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("时刻无效");
      const place = a.place ?? existing?.place ?? lesson.place;
      const conflicts = lessonConflict(
        s,
        lesson,
        date,
        time,
        lesson.durationMinutes,
        originalDate ? lesson.id + "@" + originalDate : "",
      );
      if (conflicts.length && a.confirmConflict !== true)
        fail(
          "与 " +
            conflicts.map((x) => x.title).join("、") +
            " 时间重叠，确认后仍可保存",
        );
      const noChange =
        !!existing &&
        date === originalDate &&
        time === lesson.time &&
        place === lesson.place &&
        !(a.note || existing.note);
      if (noChange) {
        existing.deletedAt = iso;
        stamp(existing, now);
      } else upsert({ date, time, place, note: a.note, status: "scheduled" });
    } else fail("未知的课程安排操作");
  } else if (a.action === "lessonCharge") {
    const lesson = live(s, "lessons", a.id);
    if (lesson.mode !== "credit") fail("只有课时包课程才需要充值记录");
    if (a.command === "remove") {
      const row = live(s, "lessonCharges", a.removeId);
      if (row.lessonId !== lesson.id) fail("记录不属于该课程");
      if (row.kind === "use") fail("上课扣减请使用撤销上课，不要直接删除");
      row.deletedAt = iso;
      stamp(row, now);
    } else {
      const item = LessonChargeInput.parse({ ...a.item, lessonId: lesson.id });
      if (!item.delta) fail("本次增减课时不能为 0");
      if (["purchase", "gift", "opening"].includes(item.kind) && item.delta < 0)
        fail("充值、赠送和首次余额应填写正数");
      if (item.kind === "use") fail("上课扣减请在课程中记录上课");
      if (item.kind === "refund" && item.delta < 0) fail("返还课时应填写正数");
      s.lessonCharges.push({ ...item, ...nowMeta(now) });
    }
  } else if (a.action === "settings") {
    if (a.command === "reviewTemplate" && a.text !== s.settings.reviewTemplate)
      fail("模板已在其他窗口更新，当前编辑内容保留，请先核对最新模板");
    const patch = { ...a.item };
    if (Object.hasOwn(patch, "reviewTemplate"))
      patch.reviewTemplate = normalizeTemplate(patch.reviewTemplate);
    s.settings = Settings.parse({ ...s.settings, ...patch });
  } else if (a.action === "ack")
    s.noticeAcks = [...new Set([...s.noticeAcks, ...(a.keys || [])])].slice(
      -2000,
    );
  else if (a.action === "timer") {
    let t = s.timer;
    if (a.command === "start") {
      if (t) fail("请先结束当前专注或休息");
      if (a.taskId) live(s, "tasks", a.taskId);
      const phase = a.phase || "focus";
      if (!["focus", "short", "long"].includes(phase)) fail("阶段无效");
      const duration = durationSeconds(s.settings, phase, a.item?.minutes);
      s.timer = {
        id: randomUUID(),
        phase,
        status: "running",
        taskId: a.taskId || "",
        originalDate: a.originalDate || "",
        title: a.taskId ? live(s, "tasks", a.taskId).title : "",
        startedAt: now,
        segmentAt: now,
        duration,
        elapsed: 0,
        deadline: now + duration * 1000,
        round: Number(a.round || 0),
      };
    } else {
      if (!t || a.timerId !== t.id) fail("计时器已更新，请刷新");
      if (a.command === "pause") {
        if (t.status !== "running") fail("当前未在运行");
        t.elapsed = timerSeconds(t, now);
        t.status = "paused";
      } else if (a.command === "resume") {
        if (t.status !== "paused") fail("只有暂停的计时器可继续");
        t.segmentAt = now;
        t.deadline = now + (t.duration - t.elapsed) * 1000;
        t.status = "running";
      } else if (a.command === "await") {
        t.elapsed = timerSeconds(t, now);
        t.status = "awaiting";
      } else if (a.command === "finish" || a.command === "discard") {
        if (a.command === "finish" && t.phase === "focus") {
          let seconds = Math.floor(timerSeconds(t, now));
          if (a.seconds !== undefined) {
            seconds = Number(a.seconds);
            if (
              !Number.isInteger(seconds) ||
              seconds < 0 ||
              seconds > Math.floor(timerSeconds(t, now))
            )
              fail("修正时长应在已计时时长内");
          }
          s.focusLogs.push({
            ...nowMeta(now),
            taskId: t.taskId,
            originalDate: t.originalDate,
            title: t.title,
            startedAt: new Date(t.startedAt).toISOString(),
            seconds,
            completed: seconds >= t.duration,
            date: today(s.settings.timeZone, t.startedAt),
          });
        }
        s.timer = null;
      } else fail("计时操作无效");
    }
  } else fail("未知操作");
  s.revision++;
  if (a.requestId)
    s.receipts = [
      ...s.receipts,
      { key: String(a.requestId).slice(0, 200), revision: s.revision },
    ].slice(-500);
  return State.parse(s);
}
export function validateState(input) {
  const s = State.parse(input);
  if (new Set(s.dayPlans.map((p) => p.date)).size !== s.dayPlans.length)
    fail("备份含重复的每日计划");
  const all = [
    "projects",
    "tasks",
    "habits",
    "lessons",
    "lessonTerms",
    "lessonSessions",
    "lessonCharges",
    "occurrences",
    "habitLogs",
    "reviews",
    "focusLogs",
  ].flatMap((k) => s[k]);
  if (new Set(all.map((x) => x.id)).size !== all.length) fail("备份含重复 ID");
  const tasks = new Set(s.tasks.map((x) => x.id)),
    habits = new Set(s.habits.map((x) => x.id)),
    projects = new Set(s.projects.map((x) => x.id));
  if (
    s.tasks.some((t) => t.projectId && !projects.has(t.projectId)) ||
    s.occurrences.some((x) => !tasks.has(x.taskId)) ||
    s.habitLogs.some((x) => !habits.has(x.habitId))
  )
    fail("备份含无效关联");
  if (
    new Set(
      s.occurrences
        .filter((x) => !x.deletedAt)
        .map((x) => x.taskId + "@" + x.originalDate),
    ).size !== s.occurrences.filter((x) => !x.deletedAt).length
  )
    fail("备份含重复发生记录");
  const lessonIds = new Set(s.lessons.map((x) => x.id));
  if (
    s.lessonTerms.some((x) => !lessonIds.has(x.lessonId)) ||
    s.lessonSessions.some((x) => !lessonIds.has(x.lessonId)) ||
    s.lessonCharges.some((x) => !lessonIds.has(x.lessonId))
  )
    fail("备份含无效课程关联");
  const sessionKeys = s.lessonSessions
    .filter((x) => !x.deletedAt && x.originalDate)
    .map((x) => x.lessonId + "@" + x.originalDate);
  if (new Set(sessionKeys).size !== sessionKeys.length)
    fail("备份含重复的课程安排记录");
  const sessionIds = new Set(s.lessonSessions.map((x) => x.id));
  if (s.lessonCharges.some((x) => x.sessionId && !sessionIds.has(x.sessionId)))
    fail("备份含无效的上课扣减关联");
  for (const id of lessonIds) {
    const terms = s.lessonTerms.filter(
      (x) => x.lessonId === id && !x.deletedAt,
    );
    for (let i = 0; i < terms.length; i++)
      for (let j = i + 1; j < terms.length; j++)
        if (terms[i].start <= terms[j].end && terms[j].start <= terms[i].end)
          fail("备份含重叠的课程有效期");
    const lesson = s.lessons.find((x) => x.id === id);
    if (lesson?.mode === "term" && !terms.length)
      fail("备份含没有有效期的期限课程");
  }
  for (const t of s.tasks.filter((t) => !t.deletedAt)) {
    const settings = { ...s, tasks: [] };
    validateTask(settings, t);
  }
  return s;
}
export async function createService(unit, clock = () => Date.now()) {
  const initial = (await unit.loadAll()).global;
  let current = initial ? validateState(initial) : blankState(randomUUID());
  // Habits no longer carry a time-of-day label. Old rows are normalized by the
  // schema; persist that once so the field does not linger in storage.
  if (initial && initial.habits?.some((h) => h && "period" in h)) {
    current.revision = initial.revision + 1;
    await unit.setGlobal(current);
  }
  let queue = Promise.resolve();
  let previous = null;
  return {
    async operate(a) {
      const run = queue.then(async () => {
        if (a.action === "read") return structuredClone(current);
        if (a.action === "plan" && (!a.command || a.command === "read")) {
          const date = day.parse(
            a.date || today(current.settings.timeZone, clock()),
          );
          return {
            ...dailyPlan(current, date),
            inboxCount: inboxTasks(current).length,
            revision: current.revision,
          };
        }
        if (a.action === "preview") {
          const t = TaskInput.parse(a.item);
          validateTask(current, t);
          const from = a.from || today(current.settings.timeZone, clock());
          return { dates: ruleDates(t, from, shift(from, 735)).slice(0, 3) };
        }
        if (a.action === "range")
          return { items: occurrences(current, a.from, a.to) };
        if (a.action === "backup")
          return {
            format: "dsh-time-desk",
            exportedAt: new Date(clock()).toISOString(),
            state: structuredClone(current),
          };
        if (a.action === "restoreBackup") {
          if (a.revision !== current.revision)
            fail("数据已变化，请重新确认恢复");
          if (a.confirm !== true) fail("恢复需要确认");
          const backup = a.backup;
          if (!["dsh-time-desk", "dsh-life-desk"].includes(backup?.format))
            fail("备份格式不支持");
          const restored = validateState(backup.state);
          await unit.putRecord("backups", "before-restore", current);
          restored.revision = current.revision + 1;
          restored.deviceId = current.deviceId;
          restored.timer = null;
          restored.receipts = [];
          await unit.setGlobal(restored);
          current = restored;
          previous = null;
          return structuredClone(current);
        }
        if (a.action === "restorePrevious") {
          if (a.revision !== current.revision || !a.confirm)
            fail("请先读取并确认恢复");
          const raw = await unit.loadAll();
          const old = raw.tables.backups?.["before-restore"];
          if (!old) fail("没有恢复前备份");
          const next = validateState(old);
          next.revision = current.revision + 1;
          next.timer = null;
          await unit.setGlobal(next);
          current = next;
          previous = null;
          return structuredClone(current);
        }
        if (a.action === "undo") {
          if (!previous || a.revision !== current.revision)
            fail("无法撤销：数据已变化或应用已重启");
          const next = structuredClone(previous);
          next.revision = current.revision + 1;
          await unit.setGlobal(next);
          current = next;
          previous = null;
          return structuredClone(current);
        }
        const next = applyAction(current, a, clock());
        if (next.revision !== current.revision) {
          await unit.setGlobal(next);
          previous = current;
          current = next;
        }
        return structuredClone(current);
      });
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      await queue;
      await unit.close();
    },
  };
}
