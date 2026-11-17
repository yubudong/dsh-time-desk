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
  day,
} from "./schema.js";
import {
  occurrences,
  today,
  shift,
  habitDue,
  habitRule,
  habitProgress,
  ruleDates,
  zonedStamp,
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
      !["projects", "tasks", "habits", "reviews", "focusLogs"].includes(
        collection,
      )
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
      const value = Number(a.value ?? 1);
      if (!Number.isFinite(value) || value < 0 || value > 1000000)
        fail("数量应为 0–1000000");
      const rule = habitRule(h, date);
      const logs = s.habitLogs.filter(
        (x) => !x.deletedAt && x.habitId === h.id && x.date === date,
      );
      if (
        rule.mode !== "quantity" &&
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
    const text = String(a.text || "");
    if (text.length > 20000) fail("复盘最多 20000 字");
    const old = s.reviews.find(
      (x) => x.date === date && x.kind === a.kind && !x.deletedAt,
    );
    if (old) {
      old.text = text;
      stamp(old, now);
    } else s.reviews.push({ ...nowMeta(now), date, kind: a.kind, text });
    if (a.kind === "day" && text.trim() && date <= localDay)
      for (const h of s.habits.filter(
        (h) =>
          !h.deletedAt &&
          h.reviewLinked &&
          habitDue(h, date) &&
          habitRule(h, date)?.mode === "daily",
      )) {
        if (
          !habitProgress(s, h, date).done &&
          !habitProgress(s, h, date).skipped &&
          !habitProgress(s, h, date).missed
        )
          s.habitLogs.push({
            ...nowMeta(now),
            habitId: h.id,
            date,
            value: habitRule(h, date).target,
            skipped: false,
            note: "关联复盘",
          });
      }
  } else if (a.action === "settings")
    s.settings = Settings.parse({ ...s.settings, ...a.item });
  else if (a.action === "ack")
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
