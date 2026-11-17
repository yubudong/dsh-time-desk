import {
  LessonInput,
  LessonTermInput,
  LessonSessionInput,
  LessonChargeInput,
  day,
} from "./schema.js";
import {
  lessonAccount,
  lessonTerms,
  lessonTermAt,
  lessonScheduleAt,
  lessonDue,
  lessonTimeFor,
  lessonConflict,
  activeLessonUsage,
  lessonScheduleSignature,
} from "./lessons.js";
import { shift, zonedStamp } from "./dates.js";
const fail = (m) => {
  throw Error(m);
};
const scheduleKeys = [
  "weekdays",
  "weekdayTimes",
  "time",
  "durationMinutes",
  "place",
  "until",
  "defaultDeduction",
];
export function scheduleSnapshot(lesson, from = lesson.effective) {
  return {
    from,
    ...Object.fromEntries(scheduleKeys.map((k) => [k, lesson[k]])),
  };
}
export function writeLessonTerm(s, lesson, input, c) {
  const { live, stamp, now, nowMeta } = c;
  const old = input?.id ? live(s, "lessonTerms", input.id) : null;
  if (old && old.lessonId !== lesson.id) fail("有效期不属于该课程");
  if (old && input.version !== undefined && input.version !== old.version)
    fail("有效期已被修改，请核对最新记录");
  const data = LessonTermInput.parse({ ...old, ...input, lessonId: lesson.id });
  if (
    s.lessonTerms.some(
      (x) =>
        !x.deletedAt &&
        x.lessonId === lesson.id &&
        x.id !== old?.id &&
        x.start <= data.end &&
        data.start <= x.end,
    )
  )
    fail("有效期与已有周期重叠");
  if (
    old &&
    s.lessonSessions.some(
      (x) =>
        !x.deletedAt &&
        x.lessonId === lesson.id &&
        ["done", "scheduled"].includes(x.status) &&
        x.date >= old.start &&
        x.date <= old.end &&
        (x.date < data.start || x.date > data.end),
    )
  )
    fail("有效期不能排除本期已上课记录或单次安排，请先核对历史与调课");
  const row = old
    ? stamp({ ...old, ...data }, now)
    : { ...data, ...nowMeta(now) };
  if (old) s.lessonTerms[s.lessonTerms.indexOf(old)] = row;
  else s.lessonTerms.push(row);
  return row;
}
function units(value) {
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 1000 ||
    Math.abs(n * 1e6 - Math.round(n * 1e6)) > 1e-6
  )
    fail("课时应为 0–1000，最多六位小数");
  return Math.round(n * 1e6) / 1e6;
}
export function applyLessonAction(s, a, c) {
  const { now, iso, localDay, nowMeta, stamp, live } = c;
  if (a.action === "lesson") {
    const old = a.id ? live(s, "lessons", a.id) : null;
    if (old && a.version !== undefined && a.version !== old.version)
      fail("这条课程已被修改，请重新读取");
    if (
      a.item?.scheduleHistory &&
      JSON.stringify(a.item.scheduleHistory) !==
        JSON.stringify(old?.scheduleHistory || [])
    )
      fail("排课历史由系统维护，请调整生效日期");
    const data = LessonInput.parse({ ...old, ...a.item });
    data.weekdays.sort((x, y) => x - y);
    data.weekdayTimes.sort((x, y) => x.weekday - y.weekday);
    if (old) {
      if (
        old.mode !== data.mode &&
        (s.lessonSessions.some((x) => x.lessonId === old.id) ||
          s.lessonCharges.some((x) => x.lessonId === old.id) ||
          s.lessonTerms.some((x) => x.lessonId === old.id))
      )
        fail("已有历史的课程不能更改管理方式，请新建课程");
      if (old.effective !== data.effective)
        fail("原开始日期应保留，请选择后续排课生效日期");
      const changed =
        lessonScheduleSignature(data) !== lessonScheduleSignature(old);
      if (changed) {
        const from = day.parse(a.from || localDay);
        if (from < localDay || from < old.effective)
          fail("后续排课只能从今天或以后的日期生效");
        if (a.confirm !== true)
          fail("请确认从所选日期调整后续排课，过去安排保持不变");
        const history = old.scheduleHistory?.length
          ? old.scheduleHistory
          : [scheduleSnapshot(old)];
        if (history.some((x) => x.from > from))
          fail("已有更晚的排课变更，请先查看排期历史再调整");
        data.scheduleHistory = [
          ...history.filter((x) => x.from < from),
          scheduleSnapshot(data, from),
        ];
      }
    }
    const row = old
      ? stamp({ ...old, ...data }, now)
      : { ...data, ...nowMeta(now) };
    if (old) s.lessons[s.lessons.indexOf(old)] = row;
    else s.lessons.push(row);
    if (a.term && row.mode !== "term") fail("只有期限课程可以设置有效期周期");
    if (a.term) writeLessonTerm(s, row, a.term, c);
    if (row.mode === "term" && !lessonTerms(s, row.id).length)
      fail("期限课程需要填写有效期");
    if (a.opening !== undefined && a.opening !== null && a.opening !== "") {
      if (row.mode !== "credit") fail("只有课时包课程可以填写现有余额");
      const delta = Number(a.opening);
      if (
        !Number.isFinite(delta) ||
        delta < 0 ||
        delta > 100000 ||
        Math.abs(delta * 1e6 - Math.round(delta * 1e6)) > 1e-6
      )
        fail("现有余额应为 0–100000，最多六位小数");
      if (delta > 0) {
        if (s.lessonCharges.some((x) => !x.deletedAt && x.lessonId === row.id))
          fail("已有账目，请使用充值或调整记录修改余额");
        s.lessonCharges.push({
          ...nowMeta(now),
          lessonId: row.id,
          date: localDay,
          delta,
          kind: "opening",
          amount: null,
          note: "现有余额",
          sessionId: "",
          reversesId: "",
          expiresOn: "",
        });
      }
    }
    return;
  }
  const lesson = live(s, "lessons", a.id);
  if (a.action === "lessonTerm") {
    if (lesson.mode !== "term") fail("只有期限课程可以设置有效期");
    if (a.command === "remove") {
      const term = live(s, "lessonTerms", a.removeId);
      if (term.lessonId !== lesson.id) fail("有效期不属于该课程");
      if (a.version !== undefined && a.version !== term.version)
        fail("有效期已被修改");
      if (
        s.lessonSessions.some(
          (x) =>
            !x.deletedAt &&
            x.lessonId === lesson.id &&
            x.status === "done" &&
            x.date >= term.start &&
            x.date <= term.end,
        )
      )
        fail("该有效期已有上课记录，不能删除");
      if (lessonTerms(s, lesson.id).length <= 1)
        fail("期限课程至少保留一个周期");
      term.deletedAt = iso;
      stamp(term, now);
    } else {
      const last = lessonTerms(s, lesson.id).at(-1);
      const base =
        a.command === "renew" && last
          ? { start: shift(last.end, 1), purchased: 0, amount: null, note: "" }
          : {};
      writeLessonTerm(s, lesson, { ...base, ...a.item }, c);
    }
    return;
  }
  if (a.action === "lessonCharge") {
    if (lesson.mode !== "credit") fail("只有课时包课程才需要充值记录");
    if (a.command === "remove") {
      const row = live(s, "lessonCharges", a.removeId);
      if (row.lessonId !== lesson.id) fail("记录不属于该课程");
      if (
        row.kind === "use" ||
        row.kind === "refund" ||
        row.sessionId ||
        row.reversesId
      )
        fail("系统扣减和返还不能删除，请用撤销上课或新增调整");
      row.deletedAt = iso;
      stamp(row, now);
    } else {
      const item = LessonChargeInput.parse({ ...a.item, lessonId: lesson.id });
      if (
        !item.delta ||
        Math.abs(item.delta * 1e6 - Math.round(item.delta * 1e6)) > 1e-6
      )
        fail("课时数不能为 0，最多六位小数");
      if (
        item.kind === "use" ||
        item.kind === "refund" ||
        item.sessionId ||
        item.reversesId
      )
        fail("系统扣减和返还必须由上课或撤销产生");
      if (["purchase", "gift", "opening"].includes(item.kind) && item.delta < 0)
        fail("充值、赠送和首次余额应填写正数");
      if (
        item.kind === "opening" &&
        s.lessonCharges.some((x) => !x.deletedAt && x.lessonId === lesson.id)
      )
        fail("已有账目，请使用充值或调整");
      if (item.expiresOn && item.expiresOn < item.date)
        fail("充值有效期不能早于充值日期");
      if (item.kind === "adjust" && !item.note.trim())
        fail("调整课时请填写原因");
      s.lessonCharges.push({ ...item, ...nowMeta(now) });
    }
    return;
  }
  if (a.action !== "lessonSession") fail("课程操作无效");
  const original = a.originalDate ? day.parse(a.originalDate) : "";
  const old = a.sessionId
    ? live(s, "lessonSessions", a.sessionId)
    : s.lessonSessions.find(
        (x) =>
          !x.deletedAt &&
          x.lessonId === lesson.id &&
          original &&
          x.originalDate === original,
      ) || null;
  if (old && old.lessonId !== lesson.id) fail("记录不属于该课程");
  if (old && a.originalDate && old.originalDate !== a.originalDate)
    fail("原定日期与这节课的记录不一致，请重新读取");
  if (a.version !== undefined && a.version !== (old?.version || 0))
    fail("这一节已被修改，请核对最新记录；当前草稿保留");
  const origin = old?.originalDate || original;
  const originRule =
    lessonScheduleAt(lesson, origin || a.date || old?.date || localDay) ||
    lesson;
  const checkTerm = (date) => {
    if (lesson.mode === "term" && !lessonTermAt(lesson, s.lessonTerms, date))
      fail("该日期不在有效期内，请先调整有效期或续费");
  };
  const checkBase = () => {
    if (!old && (!origin || !lessonDue(lesson, origin, s.lessonTerms)))
      fail("该日期不属于课程安排，请使用临时加课");
  };
  const update = (patch) => {
    const date = patch.date ?? old?.date ?? origin;
    const data = LessonSessionInput.parse({
      ...old,
      lessonId: lesson.id,
      originalDate: origin,
      date,
      time: old?.time ?? lessonTimeFor(lesson, origin || date),
      place: old?.place ?? originRule.place,
      durationMinutes: old?.durationMinutes ?? originRule.durationMinutes,
      deduction: old?.deduction ?? originRule.defaultDeduction,
      status: old?.status || "scheduled",
      note: old?.note || "",
      extra: old?.extra || false,
      completedAt: old?.completedAt || null,
      chargeId: old?.chargeId || "",
      ...patch,
      changes: [
        ...(old?.changes || []),
        {
          at: iso,
          action: a.command,
          fromDate: old?.date || origin || date,
          date,
          fromTime: old?.time ?? lessonTimeFor(lesson, origin || date),
          time:
            patch.time ?? old?.time ?? lessonTimeFor(lesson, origin || date),
          note: patch.note ?? old?.note ?? "",
        },
      ],
    });
    if (data.time) zonedStamp(data.date, data.time, s.settings.timeZone);
    const row = old
      ? stamp({ ...old, ...data }, now)
      : { ...data, ...nowMeta(now) };
    if (old) s.lessonSessions[s.lessonSessions.indexOf(old)] = row;
    else s.lessonSessions.push(row);
    return row;
  };
  const charge = (row, deduction, note) => {
    if (lesson.mode !== "credit" || deduction <= 0) return;
    const use = {
      ...nowMeta(now),
      lessonId: lesson.id,
      date: row.date,
      delta: -deduction,
      kind: "use",
      amount: null,
      note,
      sessionId: row.id,
      reversesId: "",
      expiresOn: "",
    };
    s.lessonCharges.push(use);
    row.chargeId = use.id;
  };
  const checkBalance = (n) => {
    const balance = lessonAccount(s, lesson).balance;
    if (
      lesson.mode === "credit" &&
      n > 0 &&
      balance < n &&
      a.confirmShort !== true
    )
      fail(
        "课时不足：剩余 " + balance + "，本次需要 " + n + "，请确认后继续记录",
      );
  };
  if (a.command === "add") {
    if (old) fail("临时加课不能覆盖已有课程");
    const date = day.parse(a.date);
    checkTerm(date);
    const rule = lessonScheduleAt(lesson, date) || lesson;
    const time = a.time ?? lessonTimeFor(lesson, date);
    const conflicts = lessonConflict(
      s,
      lesson,
      date,
      time,
      rule.durationMinutes,
    );
    if (conflicts.length && a.confirmConflict !== true)
      fail(
        "与 " + conflicts.map((x) => x.title).join("、") + " 时间重叠，请确认",
      );
    update({
      originalDate: "",
      date,
      time,
      place: a.item?.place ?? a.place ?? rule.place,
      durationMinutes: rule.durationMinutes,
      extra: true,
      note: a.note || "",
    });
  } else if (a.command === "complete" || a.command === "skip") {
    const date = old?.date || origin;
    checkTerm(date);
    checkBase();
    if (old?.status === "done") fail("这一节已经记录上课，请先撤销");
    if (old && activeLessonUsage(s, old))
      fail("这一节已有扣费，请先撤销该笔记录");
    if (a.command === "complete" && date > localDay)
      fail("不能提前确认未来日期已经上课");
    const n = units(
      a.command === "skip"
        ? (a.deduction ?? 0)
        : (a.deduction ?? old?.deduction ?? originRule.defaultDeduction),
    );
    if (a.command === "skip" && n > 0 && lesson.mode !== "credit")
      fail("仅课时包可记录请假扣费");
    checkBalance(n);
    const row = update({
      status: a.command === "complete" ? "done" : "skipped",
      deduction: n,
      completedAt: a.command === "complete" ? iso : null,
      chargeId: "",
      note: a.note || "",
    });
    charge(row, n, a.command === "complete" ? "上课" : "请假扣费");
  } else if (a.command === "undo") {
    if (!old) fail("只有已上课或已扣费的记录可以撤销");
    const use = activeLessonUsage(s, old);
    if (old.status !== "done" && !use) fail("只有已上课或已扣费的记录可以撤销");
    if (use) {
      s.lessonCharges.push({
        ...nowMeta(now),
        lessonId: lesson.id,
        date: old.date,
        delta: Math.abs(use.delta),
        kind: "refund",
        amount: null,
        note: "撤销本次扣减",
        sessionId: old.id,
        reversesId: use.id,
        expiresOn: "",
      });
    }
    update({ status: "scheduled", completedAt: null, chargeId: "" });
  } else if (a.command === "remove") {
    if (!old?.extra) fail("只有临时增加的课程可以删除");
    if (old.status === "done" || activeLessonUsage(s, old))
      fail("已上课或扣费请先撤销");
    old.deletedAt = iso;
    stamp(old, now);
  } else if (a.command === "restore") {
    if (!old) fail("这一节没有被调整");
    if (old.status === "done" || activeLessonUsage(s, old))
      fail("已上课或扣费请先撤销再恢复安排");
    if (old.extra) fail("临时课程没有原安排，可删除或调课");
    checkTerm(origin);
    update({
      date: origin,
      time: lessonTimeFor(lesson, origin),
      place: originRule.place,
      durationMinutes: originRule.durationMinutes,
      note: "",
    });
  } else if (a.command === "save") {
    checkBase();
    if (old?.status === "done" || (old && activeLessonUsage(s, old)))
      fail("已上课或扣费请先撤销再调课");
    const date = day.parse(a.date || old?.date || origin);
    checkTerm(date);
    const time = a.time ?? old?.time ?? lessonTimeFor(lesson, origin || date);
    const duration = old?.durationMinutes ?? originRule.durationMinutes;
    const conflicts = lessonConflict(
      s,
      lesson,
      date,
      time,
      duration,
      lesson.id + "@" + (origin || "extra:" + old?.id),
    );
    if (conflicts.length && a.confirmConflict !== true)
      fail(
        "与 " + conflicts.map((x) => x.title).join("、") + " 时间重叠，请确认",
      );
    update({
      date,
      time,
      place: a.item?.place ?? a.place ?? old?.place ?? originRule.place,
      note: a.note ?? old?.note ?? "",
      status: "scheduled",
      completedAt: null,
    });
  } else fail("未知的课程安排操作");
}

export function validateLessonData(state) {
  const sessions = new Map(state.lessonSessions.map((x) => [x.id, x]));
  const charges = new Map(state.lessonCharges.map((x) => [x.id, x]));
  const reversed = new Set();
  for (const l of state.lessons) {
    let previous = "";
    for (const rule of l.scheduleHistory || []) {
      if (rule.from < l.effective || rule.from <= previous)
        fail("备份含无序或重复的排课生效日期");
      if (
        new Set(rule.weekdays).size !== rule.weekdays.length ||
        new Set(rule.weekdayTimes.map((x) => x.weekday)).size !==
          rule.weekdayTimes.length ||
        rule.weekdayTimes.some((x) => !rule.weekdays.includes(x.weekday))
      )
        fail("备份含无效的分星期排课");
      if (rule.until && rule.until < rule.from)
        fail("排课结束日期不能早于生效日期");
      previous = rule.from;
    }
    if (l.scheduleHistory?.length && l.scheduleHistory[0].from !== l.effective)
      fail("排课历史缺少初始安排");
  }
  for (const entry of state.lessonCharges) {
    if (entry.sessionId) {
      const row = sessions.get(entry.sessionId);
      if (!row || row.lessonId !== entry.lessonId)
        fail("备份含无效的课时流水关联");
    }
    if (entry.reversesId) {
      const source = charges.get(entry.reversesId);
      if (
        !source ||
        source.kind !== "use" ||
        entry.kind !== "refund" ||
        source.lessonId !== entry.lessonId ||
        source.sessionId !== entry.sessionId ||
        entry.delta !== Math.abs(source.delta)
      )
        fail("备份含无效的返还对应关系");
      if (!entry.deletedAt) {
        if (reversed.has(entry.reversesId)) fail("备份含重复返还");
        reversed.add(entry.reversesId);
      }
    }
  }
  for (const row of state.lessonSessions) {
    if (row.chargeId) {
      const source = charges.get(row.chargeId);
      if (
        !source ||
        source.deletedAt ||
        source.kind !== "use" ||
        source.sessionId !== row.id ||
        source.lessonId !== row.lessonId ||
        reversed.has(source.id)
      )
        fail("备份含无效的本次扣减关联");
    }
  }
}
