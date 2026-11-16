import * as React from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import zhLocale from "@fullcalendar/core/locales/zh-cn";
import { zh, en } from "./locales";
import { createSpiritPanel } from "./SpiritPanel";
import { SpiritIcon } from "./SpiritIcon";
import { createTimerUI } from "./TimerUI";
import { Tomatoes } from "./Tomatoes";
import { taskFocus, todayHabits } from "./today-view.js";
import { dailyPlan, inboxTasks, planKey } from "./planning.js";
import { createPlanningUI } from "./PlanningUI";
import {
  today,
  shift,
  monday,
  weekday,
  habitDue,
  habitRule,
  habitProgress,
  occurrences,
  ruleDates,
  lunarLabel,
  zonedStamp,
} from "./dates.js";
import baseCss from "./style.css";
import spiritCss from "./spirit.css";
import todayCss from "./today.css";
import focusCss from "./focus.css";
import planningCss from "./planning.css";
const css = baseCss + spiritCss + todayCss + focusCss + planningCss;
const { useState, useEffect, useRef, useSyncExternalStore } = React;
const NAV = ["today", "projects", "habits", "life", "calendar", "review"];
const paths = {
  today:
    "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  projects: "M3 7h7l2 2h9v10H3ZM3 7V5h7l2 2",
  habits: "M19 7a8 8 0 1 0 1 8M19 3v5h-5m-6 4 3 3 5-6",
  life: "m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7",
  calendar: "M4 5h16v16H4ZM8 3v4m8-4v4M4 10h16m-11 4h2v3H9Z",
  review:
    "M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1m0-15c3-2 7-2 9-1v15c-3-1-6-1-9 1Zm0 0v15",
  inbox: "M4 4h16v16H4ZM4 13h5l1 3h4l1-3h5",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  focus: "M9 2h6m-3 0v3m6 0 2 2M12 9v5l3 1M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  ai: "m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z",
};
function Icon({ name = "focus", size = 20 }: { name?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.focus} />
    </svg>
  );
}
function uid() {
  return crypto.randomUUID();
}
import { createRequest } from "./transport.js";
export const inject = ["slots", "locale", "layout"];
export function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register("lifeDesk", { zh, en }));
  const t = ctx.locale.bind("lifeDesk");
  const reviewDrafts = new Map<string, string>();
  let snapshot: any = { data: null, error: "", busy: false },
    listeners = new Set<() => void>(),
    disposed = false;
  const emit = () => listeners.forEach((f) => f());
  const subscribe = (f: () => void) => {
    listeners.add(f);
    return () => listeners.delete(f);
  };
  const send = (input: string, init: RequestInit) => {
    const transport = (window as any).__DSH_TRANSPORT__;
    return transport?.fetch ? transport.fetch(input, init) : fetch(input, init);
  };
  const fetchAction = createRequest(send, t);
  const updateRequest = (command: string, extra: any = {}) =>
    fetchAction({ action: "update", command, ...extra });
  const upgradeRequest = (command: string, extra: any = {}) =>
    fetchAction({ action: "upgrade", command, ...extra });
  const SpiritPanel = createSpiritPanel({ send, t, refresh });
  const timerUI = createTimerUI({ useStore, act, t, ctx });
  const { Timer, Fullscreen } = timerUI;
  ctx.effect(() => () => timerUI.dispose());
  async function refresh() {
    try {
      const value = await fetchAction({ action: "read" });
      if (disposed) return;
      if (
        !snapshot.data ||
        value.revision > snapshot.data.revision ||
        snapshot.error
      ) {
        snapshot = { ...snapshot, data: value, error: "" };
        emit();
      }
    } catch (e) {
      if (!disposed) {
        snapshot = { ...snapshot, error: e.message };
        emit();
      }
    }
  }
  async function act(a: any) {
    if (snapshot.busy) throw new Error(t("loading"));
    snapshot = { ...snapshot, busy: true, error: "" };
    emit();
    try {
      const requested = timerUI.prepare(a);
      const v = await fetchAction({
        ...requested,
        revision: snapshot.data?.revision,
        requestId: a.requestId || uid(),
      });
      if (disposed) return v;
      if (v.schemaVersion) snapshot = { ...snapshot, data: v };
      timerUI.didStart(requested);
      return v;
    } catch (e) {
      snapshot = { ...snapshot, error: e.message };
      throw e;
    } finally {
      snapshot = { ...snapshot, busy: false };
      emit();
    }
  }
  let lastRead = 0;
  const refreshListener = () => {
    if (Date.now() - lastRead > 1500) {
      lastRead = Date.now();
      void refresh();
    }
  };
  ctx.effect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refreshListener);
    const guard = (e: BeforeUnloadEvent) => {
      if (reviewDrafts.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      disposed = true;
      clearInterval(id);
      window.removeEventListener("focus", refreshListener);
      window.removeEventListener("beforeunload", guard);
      listeners.clear();
    };
  });
  function useStore() {
    useSyncExternalStore(
      (fn) => ctx.locale.subscribe(fn),
      () => ctx.locale.getSnapshot(),
    );
    return useSyncExternalStore(subscribe, () => snapshot);
  }
  function Btn({
    children,
    onClick,
    primary = false,
    icon = "",
    ...props
  }: any) {
    return (
      <button
        type="button"
        className={primary ? "ld-btn ld-primary" : "ld-btn"}
        onClick={onClick}
        {...props}
      >
        {icon && <Icon name={icon} size={17} />} {children}
      </button>
    );
  }
  const { QuickCapture, PlanPanel, InboxItem } = createPlanningUI({
    t,
    Btn,
    Field,
  });
  function useClock() {
    const [n, set] = useState(Date.now());
    useEffect(() => {
      const id = setInterval(() => set(Date.now()), 1000);
      return () => clearInterval(id);
    }, []);
    return n;
  }
  function Ambient({ children, data }: any) {
    let mood = data?.settings?.mood || "daily";
    if (
      data?.settings?.moodUntil &&
      data.settings.moodUntil < today(data.settings.timeZone)
    )
      mood = "daily";
    return <div className={"ld-root ld-" + mood}>{children}</div>;
  }
  function Alerts() {
    const { data } = useStore();
    const now = useClock();
    const [notices, setNotices] = useState<any[]>([]);
    const sounded = useRef(new Set());
    useEffect(() => {
      if (!data) return;
      const day = today(data.settings.timeZone, now);
      const list: any[] = [];
      if (
        data.timer &&
        data.timer.status === "running" &&
        now >= data.timer.deadline
      )
        list.push({ key: "timer:" + data.timer.id, title: t("awaiting") });
      try {
        for (const x of occurrences(data, shift(day, -7), shift(day, 366))) {
          if (
            x.reminderMinutes === null ||
            ["done", "cancelled", "skipped"].includes(x.status)
          )
            continue;
          const at =
            zonedStamp(
              x.date,
              x.time || x.reminderTime,
              data.settings.timeZone,
            ) -
            x.reminderMinutes * 60000;
          if (at <= now)
            list.push({
              key: `task:${x.id}:${x.originalDate}:${at}`,
              title: x.title + " · " + x.date + " " + (x.time || ""),
            });
        }
      } catch {}
      const due = list.filter((x) => !data.noticeAcks.includes(x.key));
      setNotices(due);
      for (const n of due) {
        if (sounded.current.has(n.key)) continue;
        sounded.current.add(n.key);
        if (
          data.settings.notifications &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(t("title"), { body: n.title, tag: n.key });
          } catch {}
        }
        if (data.settings.sound) {
          try {
            const A = window.AudioContext || (window as any).webkitAudioContext;
            if (A) {
              const c = new A(),
                o = c.createOscillator(),
                g = c.createGain();
              o.connect(g);
              g.connect(c.destination);
              g.gain.value = 0.025;
              o.frequency.value = 620;
              o.start();
              o.stop(c.currentTime + 0.15);
              o.onended = () => void c.close();
            }
          } catch {}
        }
      }
    }, [data?.revision, Math.floor(now / 10000)]);
    return notices.length ? (
      <div className="ld-global-notice" role="status">
        <Icon name="today" />
        <span>
          {notices[0].title}
          {notices.length > 1 ? " +" + (notices.length - 1) : ""}
        </span>
        <Btn
          onClick={() => {
            void act({ action: "ack", keys: notices.map((x) => x.key) }).catch(
              () => {},
            );
          }}
        >
          {t("dismiss")}
        </Btn>
      </div>
    ) : null;
  }
  function Modal({ title, onClose, children }: any) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
      const before = document.activeElement as HTMLElement;
      ref.current?.showModal();
      return () => before?.focus?.();
    }, []);
    return (
      <dialog
        ref={ref}
        className="ld-dialog"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="ld-icon-btn"
            aria-label={t("close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </dialog>
    );
  }
  function Field({ label, children, wide = false }: any) {
    return (
      <label className={"ld-field" + (wide ? " ld-wide" : "")}>
        <span>{label}</span>
        {children}
      </label>
    );
  }
  function HabitCards({ full = false, env }: any) {
    const { data, day, timeZone, habits, busy, run, openHabit, setDay, live } =
      env;
    const list = habits.filter((h: any) => full || habitDue(h, day));
    const groups = todayHabits(data, day);
    const [record, setRecord] = useState<any>(null);
    const [amount, setAmount] = useState("1");
    const [note, setNote] = useState("");
    const renderHabit = (h: any) => {
      const r = habitRule(h, day);
      const p = habitProgress(data, h, day);
      const weekDays = Array.from({ length: 7 }, (_, i) =>
        shift(monday(day), i),
      );
      const count = weekDays.filter(
        (d) => habitProgress(data, h, d).done,
      ).length;
      return (
        <div key={h.id} className="ld-habit">
          <div className="ld-habit-main">
            <button
              className="ld-task-body"
              onClick={() => {
                if (full) openHabit(h);
                else {
                  setAmount(
                    r?.mode === "quantity"
                      ? String(Math.max(1, r.target - p.value))
                      : "1",
                  );
                  setNote("");
                  setRecord(h);
                }
              }}
            >
              <span className="ld-task-title">{h.title}</span>
              <span className="ld-task-meta">
                {r?.paused
                  ? t("paused")
                  : p.missed
                    ? t("missedHabit")
                    : p.skipped
                      ? t("skipped")
                      : r?.mode === "weekly"
                        ? `${t("weekly")} · ${count}/${r.target}`
                        : r?.mode === "quantity"
                          ? `${p.value}/${r.target} ${r.unit}`
                          : p.done
                            ? t("done")
                            : t(h.period)}
              </span>
            </button>
            <button
              className={"ld-habit-check " + (p.done ? "checked" : "")}
              aria-label={t("log") + " " + h.title}
              disabled={busy || !habitDue(h, day) || day > today(timeZone)}
              onClick={() => {
                setAmount(
                  r?.mode === "quantity"
                    ? String(Math.max(1, r.target - p.value))
                    : "1",
                );
                setNote("");
                setRecord(h);
              }}
            >
              <Icon name={p.done ? "check" : "plus"} size={17} />
            </button>
          </div>
          {full && (
            <div className="ld-week-dots">
              {weekDays.map((d) => {
                const q = habitProgress(data, h, d);
                return (
                  <button
                    key={d}
                    className={q.done ? "checked" : ""}
                    disabled={d > today(timeZone) || !habitDue(h, d)}
                    title={d}
                    onClick={() => {
                      setDay(d);
                      setAmount("1");
                      setNote("");
                      setRecord(h);
                    }}
                  >
                    {d.slice(8)}
                    {q.done ? " ·" : ""}
                  </button>
                );
              })}
              <Btn onClick={() => openHabit(h)}>{t("edit")}</Btn>
            </div>
          )}
        </div>
      );
    };
    return (
      <>
        {full ? (
          <div className="ld-habit-list">{list.map(renderHabit)}</div>
        ) : (
          <>
            {["morning", "any", "evening"].map((period) => {
              const items = groups.pending.filter(
                (h: any) => h.period === period,
              );
              return items.length ? (
                <div className="ld-habit-group" key={period}>
                  <h3>{t(period)}</h3>
                  {items.map(renderHabit)}
                </div>
              ) : null;
            })}
            {!groups.pending.length && (
              <p className="ld-help">{t("noPendingHabits")}</p>
            )}
            {groups.done.length > 0 && (
              <details className="ld-details">
                <summary>
                  {t("doneHabits")} · {groups.done.length}
                </summary>
                {groups.done.map(renderHabit)}
              </details>
            )}
            {groups.settled.length > 0 && (
              <details className="ld-details">
                <summary>
                  {t("settledHabits")} · {groups.settled.length}
                </summary>
                {groups.settled.map(renderHabit)}
              </details>
            )}
            {groups.weekly.length > 0 && (
              <section className="ld-weekly-goals">
                <h3>{t("weeklyHabits")}</h3>
                {groups.weekly.map((h: any) => {
                  const r = habitRule(h, day);
                  const count = Array.from({ length: 7 }, (_, i) =>
                    shift(monday(day), i),
                  ).filter((d) => habitProgress(data, h, d).done).length;
                  const planned = h.plannedDates?.includes(day);
                  return (
                    <div className="ld-weekly-row" key={h.id}>
                      <span>
                        {h.title}
                        <small>
                          {count}/{r.target} {t("daysUnit")}
                        </small>
                      </span>
                      <Btn
                        disabled={busy || habitProgress(data, h, day).done}
                        onClick={() =>
                          run({
                            action: "habitLog",
                            id: h.id,
                            date: day,
                            status: planned ? "unplanned" : "planned",
                          })
                        }
                      >
                        {t(planned ? "unplanHabit" : "planHabit")}
                      </Btn>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
        {record && (
          <Modal
            title={record.title + " · " + day}
            onClose={() => setRecord(null)}
          >
            <p className="ld-help">
              {t(
                habitRule(record, day)?.mode === "quantity"
                  ? "quantityHint"
                  : "checkInHint",
              )}
            </p>
            <div className="ld-form">
              {habitRule(record, day)?.mode === "quantity" && (
                <Field label={t("addValue")}>
                  <input
                    type="number"
                    min="1"
                    max="1000000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
              )}
              <Field label={t("note")}>
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <div className="ld-actions">
              <Btn
                primary
                disabled={busy}
                onClick={async () => {
                  if (
                    await run({
                      action: "habitLog",
                      id: record.id,
                      date: day,
                      value:
                        habitRule(record, day)?.mode === "quantity"
                          ? Number(amount)
                          : 1,
                      note,
                    })
                  )
                    setRecord(null);
                }}
              >
                {t(
                  habitRule(record, day)?.mode === "quantity"
                    ? "recordQuantity"
                    : "check",
                )}
              </Btn>
              <Btn
                disabled={busy}
                onClick={async () => {
                  if (
                    await run({
                      action: "habitLog",
                      id: record.id,
                      date: day,
                      skipped: true,
                      note,
                    })
                  )
                    setRecord(null);
                }}
              >
                {t("skip")}
              </Btn>
              <Btn
                disabled={busy || day > today(timeZone)}
                onClick={async () => {
                  if (
                    await run({
                      action: "habitLog",
                      id: record.id,
                      date: day,
                      status: "missed",
                      note,
                    })
                  )
                    setRecord(null);
                }}
              >
                {t("missedHabit")}
              </Btn>
            </div>
            <h3>{t("history")}</h3>
            {live("habitLogs")
              .filter((l: any) => l.habitId === record.id && l.date === day)
              .map((l: any) => (
                <div className="ld-log" key={l.id}>
                  <span>
                    {l.missed
                      ? t("missedHabit")
                      : l.skipped
                        ? t("skipped")
                        : l.value +
                          " " +
                          (habitRule(record, day)?.unit || "")}{" "}
                    {l.note}
                  </span>
                  <Btn
                    disabled={busy}
                    onClick={() =>
                      run({
                        action: "habitLog",
                        id: record.id,
                        date: day,
                        removeId: l.id,
                      })
                    }
                  >
                    {t("undo")}
                  </Btn>
                </div>
              ))}
          </Modal>
        )}
      </>
    );
  }
  function Review({ env }: any) {
    const { data, day, timeZone, live, busy, run, tasks, projects } = env;
    const [kind, setKind] = useState("day");
    const date = kind === "week" ? monday(day) : day;
    const original =
      live("reviews").find((r: any) => r.date === date && r.kind === kind)
        ?.text || "";
    const [text, setText] = useState(
      reviewDrafts.get(kind + ":" + date) ?? original,
    );
    const textRef = useRef(text);
    textRef.current = text;
    const originalRef = useRef(original);
    originalRef.current = original;
    useEffect(() => {
      setText(reviewDrafts.get(kind + ":" + date) ?? original);
    }, [date, kind]);
    useEffect(() => {
      const f = (e: any) => {
        if (textRef.current !== originalRef.current) {
          e.preventDefault();
          e.returnValue = "";
        }
      };
      window.addEventListener("beforeunload", f);
      return () => window.removeEventListener("beforeunload", f);
    }, []);
    const switchKind = (k: string) => {
      if (text !== original && !window.confirm(t("dirty"))) return;
      setKind(k);
    };
    const from = kind === "week" ? date : day,
      to = kind === "week" ? shift(date, 6) : day;
    const records = live("focusLogs").filter(
      (x: any) => x.date >= from && x.date <= to,
    );
    const completed =
      live("occurrences").filter(
        (x: any) =>
          x.status === "done" &&
          x.completedAt &&
          today(timeZone, Date.parse(x.completedAt)) >= from &&
          today(timeZone, Date.parse(x.completedAt)) <= to,
      ).length +
      tasks.filter(
        (x: any) =>
          x.status === "done" &&
          !live("occurrences").some(
            (o: any) => o.taskId === x.id && o.status === "done",
          ) &&
          today(timeZone, Date.parse(x.updatedAt)) >= from &&
          today(timeZone, Date.parse(x.updatedAt)) <= to,
      ).length;
    return (
      <>
        <div className="ld-actions">
          <Btn onClick={() => switchKind("day")} aria-pressed={kind === "day"}>
            {t("reviewDay")}
          </Btn>
          <Btn
            onClick={() => switchKind("week")}
            aria-pressed={kind === "week"}
          >
            {t("reviewWeek")}
          </Btn>
        </div>
        <div className="ld-review-stats">
          <div>
            <strong>{completed}</strong>
            <span>{t("completed")}</span>
          </div>
          <div>
            <strong>
              {Math.floor(
                records.reduce((s: number, x: any) => s + x.seconds, 0) / 60,
              )}
            </strong>
            <span>
              {t("focused")} · {t("min")}
            </span>
          </div>
          <div>
            <strong>
              {
                live("habitLogs").filter(
                  (l: any) => l.date >= from && l.date <= to && !l.skipped,
                ).length
              }
            </strong>
            <span>{t("check")}</span>
          </div>
        </div>
        <label className="ld-field">
          <span>
            {date} · {t("reviewHint")}
          </span>
          <textarea
            className="ld-review-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              reviewDrafts.set(kind + ":" + date, e.target.value);
            }}
            maxLength={20000}
          />
        </label>
        <div className="ld-actions">
          <Btn
            primary
            disabled={busy}
            onClick={async () => {
              if (await run({ action: "review", kind, date, text }))
                reviewDrafts.delete(kind + ":" + date);
            }}
          >
            {t("save")}
          </Btn>
        </div>
        <section className="ld-section">
          <h2>{t("savedLogs")}</h2>
          {records.length ? (
            records.map((r: any) => (
              <div className="ld-log" key={r.id}>
                <span>
                  {r.date} · {r.title || t("directFocus")}
                </span>
                <span>
                  {Math.floor(r.seconds / 60)} {t("min")}
                </span>
              </div>
            ))
          ) : (
            <p className="ld-muted">{t("noRecord")}</p>
          )}
        </section>
        <section className="ld-section">
          <h2>{t("projects")}</h2>
          {projects.map((p: any) => (
            <div className="ld-log" key={p.id}>
              <span>{p.title}</span>
              <span>
                {
                  tasks.filter(
                    (x: any) => x.projectId === p.id && x.status === "done",
                  ).length
                }
                /{tasks.filter((x: any) => x.projectId === p.id).length}
              </span>
            </div>
          ))}
        </section>
      </>
    );
  }
  function Calendar({ env }: any) {
    const { data, day, tasks, habits, setDay, setTab, openTask } = env;
    const [view, setView] = useState("dayGridMonth"),
      [filter, setFilter] = useState("all");
    const [bounds, setBounds] = useState([shift(day, -40), shift(day, 40)]);
    const ref = useRef<any>(null);
    useEffect(() => {
      ref.current?.getApi().gotoDate(day);
    }, [day]);
    const range = occurrences(data, bounds[0], bounds[1]);
    const ev = range
      .filter(
        (x: any) =>
          !["cancelled", "skipped"].includes(x.status) &&
          (filter === "all" ||
            (filter === "work" ? x.area === "work" : x.area === "life")),
      )
      .map((x: any) => ({
        id: x.id + "@" + x.originalDate,
        title: x.title,
        start: x.date + (x.time ? "T" + x.time : ""),
        end:
          x.time && x.minutes
            ? new Date(
                Date.parse(x.date + "T" + x.time + ":00Z") + x.minutes * 60000,
              )
                .toISOString()
                .replace("Z", "")
            : undefined,
        allDay: !x.time,
        extendedProps: { source: x },
        classNames: [x.status === "done" ? "ld-event-done" : ""],
      }));
    const habitEvents = [];
    if (filter === "all" || filter === "habits")
      for (let d = bounds[0]; d <= bounds[1]; d = shift(d, 1)) {
        for (const h of habits) {
          const r = habitRule(h, d);
          if (r?.mode !== "weekly" && habitDue(h, d))
            habitEvents.push({
              id: "habit:" + h.id + "@" + d,
              title: h.title,
              allDay: true,
              start: d,
              editable: false,
              classNames: ["ld-event-habit"],
              extendedProps: { habit: h, date: d },
            });
        }
      }
    const events = filter === "habits" ? habitEvents : [...ev, ...habitEvents];
    return (
      <>
        <div className="ld-toolbar">
          <div className="ld-actions">
            {[
              ["dayGridMonth", "monthView"],
              ["timeGridWeek", "weekView"],
              ["timeGridDay", "dayView"],
            ].map(([v, label]) => (
              <Btn
                key={v}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  ref.current?.getApi().changeView(v);
                }}
              >
                {t(label)}
              </Btn>
            ))}
          </div>
          <select
            aria-label={t("all")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["all", "work", "life", "habits"].map((a) => (
              <option key={a} value={a}>
                {t(a)}
              </option>
            ))}
          </select>
        </div>
        <p className="ld-help">{t("calendarHint")}</p>
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={view}
          initialDate={day}
          datesSet={(info) => {
            const from = info.startStr.slice(0, 10),
              to = info.endStr.slice(0, 10);
            setBounds((old) =>
              old[0] === from && old[1] === to ? old : [from, to],
            );
          }}
          firstDay={1}
          locale={
            ctx.locale.getLocale().active.startsWith("zh") ? zhLocale : "en"
          }
          height="auto"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "",
          }}
          events={events}
          editable
          selectable
          nowIndicator
          dayMaxEvents={3}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          dateClick={(info) =>
            openTask({
              date: info.dateStr.slice(0, 10),
              time: info.allDay ? "" : info.dateStr.slice(11, 16),
            })
          }
          eventClick={(info) => {
            const p = info.event.extendedProps;
            if (p.habit) {
              setDay(p.date);
              setTab("habits");
            } else
              openTask(
                tasks.find((x: any) => x.id === p.source.id),
                { occurrence: p.source },
              );
          }}
          eventDrop={(info) => {
            const x = info.event.extendedProps.source;
            const date = info.event.startStr.slice(0, 10),
              time = info.event.allDay ? "" : info.event.startStr.slice(11, 16);
            info.revert();
            openTask(
              tasks.find((q: any) => q.id === x.id),
              { occurrence: { ...x, date, time }, forceOccurrence: true },
            );
          }}
          eventDurationEditable={false}
        />
      </>
    );
  }
  function UpdateSection({
    update,
    request,
    remember,
    upgrade,
    upgradeRequest,
    rememberUpgrade,
    revision,
    editorOpen,
    spiritBusy,
    saving,
    refresh,
  }: {
    update: any;
    request: (command: string, extra?: any) => Promise<any>;
    remember: (value: any) => void;
    upgrade: any;
    upgradeRequest: (command: string, extra?: any) => Promise<any>;
    rememberUpgrade: (value: any) => void;
    revision: number;
    editorOpen: boolean;
    spiritBusy: () => boolean;
    saving: boolean;
    refresh: () => Promise<void>;
  }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [showNotes, setShowNotes] = useState(false);
    const v = update || {};
    const current = v.currentVersion || __LIFE_DESK_VERSION__;
    const state = v.state || { kind: "none" };
    const cache = v.cache?.release || null;
    const install = v.installKind || "unknown";
    const installText =
      install === "development"
        ? t("installDevelopment")
        : install === "managed"
          ? t("installManaged")
          : t("installUnknown");
    const releaseUrl = cache?.url || v.releasePage || "";
    const check = async (force = true) => {
      setBusy(true);
      setError("");
      try {
        remember(await request("check", { force }));
      } catch (e: any) {
        setError(e?.message || t("updateCheckFailed"));
      } finally {
        setBusy(false);
      }
    };
    const setAuto = async (next: boolean) => {
      try {
        remember(await request("settings", { autoCheck: next }));
      } catch (e: any) {
        setError(e?.message || t("updateCheckFailed"));
      }
    };
    const ignore = async (version: string) => {
      try {
        remember(await request("ignore", { version }));
      } catch (e: any) {
        setError(e?.message || t("updateCheckFailed"));
      }
    };
    const openPlugins = () => {
      try {
        ctx.layout.selectPanel("plugins");
      } catch {
        setError(t("openPluginsFailed"));
      }
    };
    const up = upgrade || {};
    const pending = up.pending || null;
    const snapshots = up.snapshots || [];
    const upgraded = !!(pending && pending.targetVersion === current);
    const [preparing, setPreparing] = useState(false);
    const [upgradeError, setUpgradeError] = useState("");
    const [blockers, setBlockers] = useState<string[]>([]);
    const [restored, setRestored] = useState("");
    const openUpgradeManager = () => {
      try {
        ctx.layout.selectPanel("plugins");
      } catch {
        setUpgradeError(t("openPluginsFailed"));
      }
    };
    const startUpgrade = async (target: string) => {
      setUpgradeError("");
      setBlockers([]);
      setRestored("");
      const localBlockers: string[] = [];
      if (editorOpen) localBlockers.push(t("upgradeBlockEditor"));
      if (spiritBusy()) localBlockers.push(t("upgradeBlockAssistant"));
      if (saving) localBlockers.push(t("upgradeBlockBusy"));
      if (localBlockers.length) {
        setBlockers(localBlockers);
        return;
      }
      setPreparing(true);
      try {
        const pre = await upgradeRequest("preflight");
        if (!pre.ok) {
          setBlockers(
            pre.blockers.map((x: any) =>
              t(
                x.code === "timer"
                  ? "upgradeBlockTimer"
                  : "upgradeBlockAssistant",
              ),
            ),
          );
          return;
        }
        rememberUpgrade(
          await upgradeRequest("prepare", {
            targetVersion: target,
            fromVersion: current,
            revision: pre.revision,
          }),
        );
        openUpgradeManager();
      } catch (e: any) {
        setUpgradeError(e?.message || t("updateCheckFailed"));
      } finally {
        setPreparing(false);
      }
    };
    const restore = async (snap: any) => {
      if (
        !window.confirm(
          t("restoreSnapshotConfirm") +
            "\n\nv" +
            snap.fromVersion +
            " → v" +
            snap.targetVersion,
        )
      )
        return;
      setUpgradeError("");
      try {
        const result = await upgradeRequest("restoreSnapshot", {
          id: snap.id,
          confirm: true,
          revision,
        });
        setRestored(t("snapshotRestored"));
        if (result.warning) setUpgradeError(result.warning);
        await refresh();
        rememberUpgrade(await upgradeRequest("snapshots"));
      } catch (e: any) {
        setUpgradeError(e?.message || t("updateCheckFailed"));
      }
    };
    const dismissPending = async () => {
      try {
        rememberUpgrade(await upgradeRequest("clearPending"));
      } catch (e: any) {
        setUpgradeError(e?.message || t("updateCheckFailed"));
      }
    };
    const link = releaseUrl ? (
      <a className="ld-btn" href={releaseUrl} target="_blank" rel="noreferrer">
        {t("viewRelease")}
      </a>
    ) : null;
    return (
      <section className="ld-section ld-update" id="ld-update">
        <h2>{t("versionUpdate")}</h2>
        <div className="ld-update-meta">
          <span>{t("currentVersion")}</span>
          <strong>v{current}</strong>
          <span>{t("installKindLabel")}</span>
          <strong>{installText}</strong>
          <span>{t("currentDsh")}</span>
          <strong>
            {v.dshVersion ? "v" + v.dshVersion : t("unknownValue")}
          </strong>
          <span>{t("lastChecked")}</span>
          <strong>
            {v.lastCheck
              ? new Date(v.lastCheck).toLocaleString()
              : t("neverChecked")}
          </strong>
        </div>
        <div className="ld-actions" style={{ marginTop: 14 }}>
          <Btn primary disabled={busy} onClick={() => void check(true)}>
            {busy ? t("checkingUpdate") : t("checkNow")}
          </Btn>
          <label className="ld-check-label">
            <input
              type="checkbox"
              checked={!!v.prefs?.autoCheck}
              disabled={busy}
              onChange={(e) => void setAuto(e.target.checked)}
            />
            {t("autoCheckUpdate")}
          </label>
        </div>
        <p className="ld-help">
          {t("autoCheckHint")} {t("updateStableOnly")}
        </p>
        {v.error && !error && (
          <p className="ld-error" role="alert">
            {t("updateCheckFailed")}：{v.error.message}
          </p>
        )}
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        {v.degraded === "feed" && (
          <p className="ld-help">{t("feedFallbackNote")}</p>
        )}
        {state.kind === "none" && (
          <p className="ld-help">{t("neverChecked")}</p>
        )}
        {state.kind === "latest" && (
          <p className="ld-update-ok" role="status">
            {t("upToDate")} · v{state.version}
          </p>
        )}
        {(state.kind === "available" || state.kind === "unknown-compat") && (
          <div className="ld-update-card">
            <strong>
              {t("updateFound")} v{state.version}
            </strong>
            {state.kind === "unknown-compat" && (
              <p className="ld-help">
                {t("updateUnknownCompat")}{" "}
                {state.dshRange
                  ? t("compatRange") + " " + state.dshRange + "。"
                  : ""}{" "}
                {!v.dshVersion && t("compatUnknownNote")}
              </p>
            )}
            {cache?.notes && (
              <>
                <button
                  type="button"
                  className="ld-update-toggle"
                  aria-expanded={showNotes}
                  onClick={() => setShowNotes(!showNotes)}
                >
                  {t("releaseNotes")} {showNotes ? "⌃" : "⌄"}
                </button>
                {showNotes && (
                  <pre className="ld-release-notes">{cache.notes}</pre>
                )}
              </>
            )}
            <div className="ld-actions">
              <Btn
                primary
                disabled={preparing}
                onClick={() => void startUpgrade(state.version)}
              >
                {preparing ? t("checkingUpdate") : t("prepareUpgrade")}
              </Btn>
              {link}
              <Btn onClick={openUpgradeManager}>{t("openPluginManager")}</Btn>
              <Btn onClick={() => void ignore(state.version)}>
                {t("ignoreVersion")}
              </Btn>
            </div>
          </div>
        )}
        {state.kind === "incompatible" && (
          <div className="ld-update-card">
            <strong>{t("updateIncompatible")}</strong>
            <p className="ld-help">
              {t("updateFound")} v{state.version} · {t("compatRange")}{" "}
              {state.dshRange} · {t("currentDsh")} v{state.dshVersion}
            </p>
            <div className="ld-actions">
              {link}
              <Btn onClick={() => void ignore(state.version)}>
                {t("ignoreVersion")}
              </Btn>
            </div>
          </div>
        )}
        {state.kind === "ignored" && (
          <div className="ld-update-card">
            <strong>
              {t("updateIgnored")} · v{state.version}
            </strong>
            <div className="ld-actions">
              <Btn onClick={() => void ignore("")}>
                {t("restoreVersionAlert")}
              </Btn>
            </div>
          </div>
        )}
        {blockers.length > 0 && (
          <div className="ld-update-card" role="alert">
            <strong>{t("prepareUpgrade")}</strong>
            {blockers.map((x) => (
              <p className="ld-help" key={x}>
                {x}
              </p>
            ))}
          </div>
        )}
        {upgradeError && (
          <p className="ld-error" role="alert">
            {upgradeError}
          </p>
        )}
        {restored && (
          <p className="ld-update-ok" role="status">
            {restored}
          </p>
        )}
        {pending && (
          <div className="ld-update-card">
            <strong>
              {upgraded
                ? t("upgradeDone") + " v" + current
                : t("upgradePending") + " · v" + pending.targetVersion}
            </strong>
            <p className="ld-help">
              {upgraded
                ? t("upgradeDone") + " v" + current + "。"
                : t("upgradePendingHint")}
            </p>
            <div className="ld-actions">
              {upgraded ? (
                <Btn onClick={() => void dismissPending()}>
                  {t("upgradeClearPending")}
                </Btn>
              ) : (
                <Btn onClick={openUpgradeManager}>
                  {t("openPluginManagerAgain")}
                </Btn>
              )}
            </div>
          </div>
        )}
        {snapshots.length > 0 && (
          <div className="ld-update-card">
            <strong>
              {t("snapshotsTitle")} · {snapshots.length}
            </strong>
            {snapshots
              .slice()
              .reverse()
              .map((snap: any) => (
                <div className="ld-snapshot-row" key={snap.id}>
                  <span>
                    v{snap.fromVersion} → v{snap.targetVersion}
                  </span>
                  <small>{new Date(snap.createdAt).toLocaleString()}</small>
                  <Btn onClick={() => void restore(snap)}>
                    {t("snapshotRestore")}
                  </Btn>
                </div>
              ))}
          </div>
        )}
        {install === "development" && (
          <p className="ld-help">{t("updateDevHint")}</p>
        )}
        <p className="ld-help">{t("updateNetworkNote")}</p>
      </section>
    );
  }
  function SettingsView({ env }: any) {
    const {
      data,
      timeZone,
      run,
      busy,
      setMessage,
      update,
      request,
      remember,
      upgrade,
      upgradeRequest,
      rememberUpgrade,
      revision,
      editorOpen,
      spiritBusy,
      refresh,
    } = env;
    const [v, setV] = useState({ ...data.settings });
    const [backup, setBackup] = useState<any>(null);
    const download = (obj: any) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "life-desk-" + today(timeZone) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
      <>
        <div className="ld-form">
          <Field label={t("zone")} wide>
            <input
              value={v.timeZone}
              onChange={(e) => setV({ ...v, timeZone: e.target.value })}
            />
          </Field>
          {["focusMinutes", "shortBreak", "longBreak"].map((k, i) => (
            <Field
              key={k}
              label={t(["focusMinutes", "shortMinutes", "longMinutes"][i])}
            >
              <input
                type="number"
                min="1"
                max={k === "focusMinutes" ? 180 : k === "shortBreak" ? 60 : 120}
                value={v[k]}
                onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
              />
            </Field>
          ))}
          <Field label={t("mood")}>
            <select
              value={v.mood}
              onChange={(e) => setV({ ...v, mood: e.target.value })}
            >
              {["daily", "bright", "focus", "calm"].map((m) => (
                <option key={m} value={m}>
                  {t(
                    m === "daily"
                      ? "moodDaily"
                      : m === "focus"
                        ? "moodFocus"
                        : m,
                  )}
                </option>
              ))}
            </select>
          </Field>
          <label className="ld-check-label">
            <input
              type="checkbox"
              checked={!!v.moodUntil}
              onChange={(e) =>
                setV({
                  ...v,
                  moodUntil: e.target.checked ? today(timeZone) : "",
                })
              }
            />
            {t("moodOnlyToday")}
          </label>
          <label className="ld-check-label">
            <input
              type="checkbox"
              checked={v.sound}
              onChange={(e) => setV({ ...v, sound: e.target.checked })}
            />
            {t("sound")}
          </label>
          <label className="ld-check-label">
            <input
              type="checkbox"
              checked={v.notifications}
              onChange={(e) => setV({ ...v, notifications: e.target.checked })}
            />
            {t("notifications")}
          </label>
        </div>
        <p className="ld-help">
          {t("notifyHint")} {t("soundsHelp")}
        </p>
        <div className="ld-actions">
          <Btn
            primary
            disabled={busy}
            onClick={() =>
              run({
                action: "settings",
                item: Object.fromEntries(
                  [
                    "timeZone",
                    "mood",
                    "moodUntil",
                    "focusMinutes",
                    "shortBreak",
                    "longBreak",
                    "sound",
                    "notifications",
                  ].map((key) => [key, v[key]]),
                ),
              })
            }
          >
            {t("save")}
          </Btn>
          <Btn
            onClick={async () => {
              try {
                if (typeof Notification === "undefined")
                  throw new Error(t("notifications"));
                const p = await Notification.requestPermission();
                setMessage(p);
                if (p === "granted") setV({ ...v, notifications: true });
              } catch (e) {
                setMessage(e.message);
              }
            }}
          >
            {t("permission")}
          </Btn>
        </div>
        <section className="ld-section">
          <h2>
            {t("export")} / {t("import")}
          </h2>
          <p className="ld-muted">{t("beforeRestore")}</p>
          <div className="ld-actions">
            <Btn
              onClick={async () => {
                const b = await run({ action: "backup" });
                if (b) download(b);
              }}
            >
              {t("export")}
            </Btn>
            <label className="ld-btn ld-file">
              {t("import")}
              <input
                type="file"
                accept="application/json,.json"
                aria-label={t("backupName")}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > 10 * 1024 * 1024) throw new Error("Max 10 MB");
                    setBackup(JSON.parse(await f.text()));
                  } catch (err) {
                    setMessage(err.message);
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <Btn
              onClick={() => {
                if (window.confirm(t("confirmRestore")))
                  void run({ action: "restorePrevious", confirm: true });
              }}
            >
              {t("restorePrevious")}
            </Btn>
          </div>
          {backup && (
            <div className="ld-restore">
              <p>
                {t("confirmRestore")} · {backup.exportedAt}
              </p>
              <Btn
                primary
                disabled={busy}
                onClick={async () => {
                  if (
                    await run({
                      action: "restoreBackup",
                      backup,
                      confirm: true,
                    })
                  )
                    setBackup(null);
                }}
              >
                {t("confirm")}
              </Btn>
              <Btn onClick={() => setBackup(null)}>{t("cancel")}</Btn>
            </div>
          )}
        </section>
        <UpdateSection
          update={update}
          request={request}
          remember={remember}
          upgrade={upgrade}
          upgradeRequest={upgradeRequest}
          rememberUpgrade={rememberUpgrade}
          revision={revision}
          editorOpen={editorOpen}
          spiritBusy={spiritBusy}
          saving={busy}
          refresh={refresh}
        />
      </>
    );
  }
  function App() {
    const { data, error, busy } = useStore();
    const [tab, setTab] = useState("today"),
      [project, setProject] = useState(""),
      [selectedDay, setDay] = useState(""),
      [search, setSearch] = useState(""),
      [collapsed, setCollapsed] = useState(false),
      [board, setBoard] = useState(false),
      [editor, setEditor] = useState<any>(null),
      [message, setMessage] = useState(""),
      [ai, setAi] = useState(false),
      [lifeCategory, setLifeCategory] = useState("");
    const [captureOpen, setCaptureOpen] = useState(false);
    const [captureReset, setCaptureReset] = useState(0);
    const [captureDirty, setCaptureDirty] = useState(false);
    const captureButton = useRef<HTMLButtonElement>(null);
    const [updateView, setUpdateView] = useState<any>(null);
    const [upgradeView, setUpgradeView] = useState<any>(null);
    const [updateNotice, setUpdateNotice] = useState("");
    const updateChecking = useRef(false);
    const spiritBusyRef = useRef(false);
    const timeZone =
      data?.settings?.timeZone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = selectedDay || today(timeZone);
    const run = async (a: any) => {
      try {
        const result = await act(a);
        setMessage(
          t(
            a.action === "habitLog" && !a.removeId && !a.skipped
              ? "checkSaved"
              : "saved",
          ),
        );
        return result;
      } catch {
        return null;
      }
    };
    const openTask = (item: any = {}, extra: any = {}) =>
      setEditor({
        type: "task",
        item: {
          title: "",
          area: tab === "life" ? "life" : tab === "projects" ? "work" : "inbox",
          projectId: tab === "projects" ? project : "",
          date: "",
          time: "",
          deadline: "",
          minutes: 0,
          note: "",
          priorityDate: "",
          status: "todo",
          event: false,
          tag: "",
          reminderMinutes: null,
          reminderTime: "09:00",
          repeat: {
            kind: "none",
            interval: 1,
            days: [1],
            until: "",
            month: 1,
            day: 1,
            leap: "regular",
            leapFallback: "regular",
            missing: "last",
            monthMode: "date",
            unit: "months",
          },
          steps: [],
          ...item,
        },
        ...extra,
      });
    const openHabit = (item: any) =>
      setEditor({
        type: "habit",
        item: item || {
          title: "",
          note: "",
          period: "any",
          reviewLinked: false,
          rules: [
            {
              effective: day,
              mode: "daily",
              days: [0, 1, 2, 3, 4, 5, 6],
              target: 1,
              unit: "次",
              paused: false,
            },
          ],
        },
      });
    function go(next: string) {
      setTab(next);
      setProject("");
      setSearch("");
    }
    useEffect(() => {
      if (!data) return;
      if (!selectedDay) setDay(today(timeZone));
    }, [data?.settings?.timeZone]);
    const rememberUpdate = (next: any) => setUpdateView(next);
    useEffect(() => {
      let alive = true;
      updateRequest("status")
        .then((v: any) => {
          if (alive) rememberUpdate(v);
        })
        .catch(() => {});
      upgradeRequest("snapshots")
        .then((v: any) => {
          if (alive) setUpgradeView(v);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);
    useEffect(() => {
      const v = updateView;
      if (!v?.prefs?.autoCheck || updateChecking.current) return;
      const interval = v.autoInterval || 24 * 60 * 60 * 1000;
      if (Date.now() - (v.lastCheck || 0) < interval) return;
      updateChecking.current = true;
      updateRequest("check", { auto: true, force: false })
        .then((r: any) => {
          updateChecking.current = false;
          rememberUpdate(r);
          const kind = r?.state?.kind;
          if (kind === "available" || kind === "unknown-compat")
            setUpdateNotice(t("updateNotice") + " v" + r.state.version);
        })
        .catch(() => {
          updateChecking.current = false;
        });
    }, [updateView?.prefs?.autoCheck, updateView?.lastCheck]);
    if (!data)
      return (
        <div className="ld-root">
          <style>{css}</style>
          <div className="ld-loading">
            {error || t("loading")}{" "}
            <Btn onClick={() => void refresh()}>{t("retry")}</Btn>
          </div>
        </div>
      );
    const live = (c: string) => data[c].filter((x: any) => !x.deletedAt);
    const projects = live("projects");
    const query = search.trim().toLocaleLowerCase();
    const projectItem = projects.find((x: any) => x.id === project);
    const range = occurrences(data, shift(day, -365), shift(day, 366));
    const current = range.filter((x: any) => x.date === day);
    const tasks = live("tasks");
    const habits = live("habits");
    const planForDay = dailyPlan(data, day, range);
    const viewEnv = {
      data,
      day,
      timeZone,
      habits,
      busy,
      run,
      openHabit,
      setDay,
      live,
      tasks,
      projects,
      range,
      setTab,
      openTask,
      setMessage,
      update: updateView,
      request: updateRequest,
      remember: rememberUpdate,
      upgrade: upgradeView,
      upgradeRequest,
      rememberUpgrade: setUpgradeView,
      revision: data.revision,
      editorOpen: !!editor || captureDirty,
      spiritBusy: () => spiritBusyRef.current,
      refresh,
    };
    function taskRows(items: any[], empty = true) {
      return items.length ? (
        <div className="ld-task-list">
          {items.map((x) => {
            const isOccurrence = !!x.originalDate;
            const done = x.status === "done";
            const p = projects.find((p: any) => p.id === x.projectId);
            const complete = () => {
              if (isOccurrence)
                return run({
                  action: "occurrence",
                  id: x.id,
                  originalDate: x.originalDate,
                  status: done ? "todo" : "done",
                });
              if (x.repeat.kind !== "none") {
                setTab("calendar");
                return;
              }
              return run({
                action: "save",
                collection: "tasks",
                id: x.id,
                item: { status: done ? "todo" : "done" },
              });
            };
            return (
              <div
                className={"ld-task " + (done ? "ld-task-done" : "")}
                key={x.id + "@" + (x.originalDate || "")}
              >
                {x.event ? (
                  <span className="ld-event-dot">
                    <Icon name="calendar" size={17} />
                  </span>
                ) : (
                  <button
                    className="ld-check"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={t("done") + " " + x.title}
                    disabled={busy}
                    onClick={complete}
                  >
                    {done && <Icon name="check" size={14} />}
                  </button>
                )}
                <button
                  className="ld-task-body"
                  onClick={() =>
                    openTask(
                      tasks.find((t: any) => t.id === x.id),
                      isOccurrence ? { occurrence: x } : {},
                    )
                  }
                >
                  <span className="ld-task-title">
                    {x.priorityDate === day && (
                      <span className="ld-star">✧ </span>
                    )}
                    {x.title}
                  </span>
                  <span className="ld-task-meta">
                    {[
                      p?.title,
                      x.carriedFrom
                        ? t("carriedFrom") +
                          " " +
                          x.carriedFrom +
                          (x.time ? " " + x.time : "")
                        : x.date,
                      x.carriedFrom ? "" : x.time,
                      x.deadline ? t("deadline") + " " + x.deadline : "",
                      x.minutes ? x.minutes + " " + t("min") : "",
                      x.repeat.kind !== "none" ? "↻" : "",
                      x.repeat.kind === "lunar" && x.date
                        ? lunarLabel(x.date)
                        : "",
                      x.tag,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {!x.event && (x.pomodoros || taskFocus(data, x).completed) ? (
                    <Tomatoes
                      {...taskFocus(data, x)}
                      label={t("taskTomatoes")}
                    />
                  ) : null}
                </button>
                <div className="ld-task-tools">
                  {tab === "today" && !done && !x.event && (
                    <>
                      {x.carriedFrom && x.priorityDate !== day && (
                        <button
                          className="ld-icon-btn"
                          disabled={busy}
                          title={t(
                            planForDay.backlog.some(
                              (q: any) => planKey(q) === planKey(x),
                            )
                              ? "pickForDay"
                              : "unpickForDay",
                          )}
                          aria-label={
                            t(
                              planForDay.backlog.some(
                                (q: any) => planKey(q) === planKey(x),
                              )
                                ? "pickForDay"
                                : "unpickForDay",
                            ) +
                            " " +
                            x.title
                          }
                          onClick={() =>
                            run({
                              action: "plan",
                              command: planForDay.backlog.some(
                                (q: any) => planKey(q) === planKey(x),
                              )
                                ? "pick"
                                : "unpick",
                              date: day,
                              id: x.id,
                              originalDate: x.originalDate,
                            })
                          }
                        >
                          {planForDay.backlog.some(
                            (q: any) => planKey(q) === planKey(x),
                          )
                            ? "+"
                            : "−"}
                        </button>
                      )}
                      <button
                        className="ld-icon-btn"
                        disabled={busy}
                        title={t(
                          x.priorityDate === day
                            ? "clearPriority"
                            : "makePriority",
                        )}
                        aria-pressed={x.priorityDate === day}
                        aria-label={
                          t(
                            x.priorityDate === day
                              ? "clearPriority"
                              : "makePriority",
                          ) +
                          " " +
                          x.title
                        }
                        onClick={() =>
                          run({
                            action: "save",
                            collection: "tasks",
                            id: x.id,
                            item: {
                              priorityDate: x.priorityDate === day ? "" : day,
                            },
                          })
                        }
                      >
                        ✧
                      </button>
                    </>
                  )}
                  {!done && !x.event && (
                    <button
                      className="ld-icon-btn"
                      title={t("startFocus")}
                      aria-label={t("startFocus") + " " + x.title}
                      disabled={busy || !!data.timer}
                      onClick={() =>
                        run({
                          action: "timer",
                          command: "start",
                          taskId: x.id,
                          originalDate: x.originalDate || x.date,
                        })
                      }
                    >
                      <Icon name="focus" size={17} />
                    </button>
                  )}
                  <button
                    className="ld-icon-btn"
                    title={t("edit")}
                    aria-label={t("edit") + " " + x.title}
                    onClick={() =>
                      openTask(
                        tasks.find((t: any) => t.id === x.id),
                        isOccurrence ? { occurrence: x } : {},
                      )
                    }
                  >
                    <Icon name="more" size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : empty ? (
        <div className="ld-empty">{t("empty")}</div>
      ) : null;
    }
    function section(title: string, items: any[], extra?: any) {
      return (
        <section className="ld-section">
          <div className="ld-section-heading">
            <h2>{title}</h2>
            {extra}
          </div>
          {taskRows(items)}
        </section>
      );
    }

    function Body() {
      if (query) {
        const filtered = tasks.filter((x: any) =>
          (x.title + " " + x.note).toLocaleLowerCase().includes(query),
        );
        return (
          <>
            {taskRows(filtered)}
            <section className="ld-section">
              {projects
                .filter((p: any) =>
                  (p.title + " " + p.goal).toLocaleLowerCase().includes(query),
                )
                .map((p: any) => (
                  <button
                    key={p.id}
                    className="ld-project-row"
                    onClick={() => {
                      setSearch("");
                      setTab("projects");
                      setProject(p.id);
                    }}
                  >
                    <Icon name="projects" />
                    {p.title}
                  </button>
                ))}
            </section>
          </>
        );
      }
      if (tab === "today") {
        const groups = planForDay;
        const priority = groups.priority;
        return (
          <>
            <div className="ld-today-grid">
              <div className="ld-main-col">
                {!tasks.length && !habits.length && !projects.length && (
                  <div className="ld-welcome">
                    <Icon name="today" size={30} />
                    <h2>{t("startTitle")}</h2>
                    <p>{t("startText")}</p>
                    <div className="ld-actions">
                      <Btn primary onClick={() => openTask()}>
                        {t("addTask")}
                      </Btn>
                      <Btn onClick={() => openHabit(null)}>{t("addHabit")}</Btn>
                    </div>
                  </div>
                )}
                <PlanPanel plan={groups} date={day} act={act} busy={busy} />
                <p className="ld-help">{t("priorityHint")}</p>
                {section(
                  t("priorities"),
                  priority,
                  <span className="ld-help">{priority.length}/3</span>,
                )}
                <section className="ld-section">
                  <h2>{t("schedule")}</h2>
                  {groups.schedule.map((x: any) =>
                    priority.some((p: any) => p.id === x.id) ? (
                      <button
                        className="ld-time-index"
                        key={x.id + x.originalDate}
                        onClick={() =>
                          openTask(
                            tasks.find((q: any) => q.id === x.id),
                            { occurrence: x },
                          )
                        }
                      >
                        <span>{x.time || t("noTime")}</span>
                        <span>{x.title}</span>
                        <small>{t("priorities")}</small>
                      </button>
                    ) : (
                      <React.Fragment key={x.id + x.originalDate}>
                        {taskRows([x], false)}
                      </React.Fragment>
                    ),
                  )}
                </section>
                {section(t("plannedTodos"), groups.todos)}
                <section className="ld-section">
                  <h2>
                    {t("carryBacklog")} · {groups.backlog.length}
                  </h2>
                  <p className="ld-help">{t("carryHint")}</p>
                  {taskRows(groups.backlog)}
                </section>
                {groups.due.length > 0 && (
                  <section className="ld-section ld-deadlines">
                    <h2>{t("deadlineWatch")}</h2>
                    {groups.due.map((x: any) => (
                      <button
                        className="ld-time-index"
                        key={x.id}
                        onClick={() => openTask(x)}
                      >
                        <span>
                          {x.deadline === day
                            ? t("dueToday")
                            : x.deadline < day
                              ? t("pastDeadline")
                              : x.deadline}
                        </span>
                        <span>{x.title}</span>
                        <small>
                          {x.date
                            ? t("originalPlan") + " " + x.date
                            : t("noneDate")}
                        </small>
                      </button>
                    ))}
                  </section>
                )}
                <details className="ld-details">
                  <summary>
                    {t("done")} · {groups.completed.length}
                  </summary>
                  {taskRows(groups.completed, false)}
                </details>
                {groups.previousRecurring.length > 0 && (
                  <details className="ld-details">
                    <summary>
                      {t("earlierRecurring")} ·{" "}
                      {groups.previousRecurring.length}
                    </summary>
                    {taskRows(groups.previousRecurring)}
                  </details>
                )}
                <details className="ld-details">
                  <summary>
                    {t("inbox")} · {inboxTasks(data).length}
                  </summary>
                  {taskRows(inboxTasks(data))}
                </details>
              </div>
              <aside className="ld-support">
                <div className="ld-side-timer">
                  <Timer />
                </div>
                <section className="ld-section">
                  <h2>{t("todayHabits")}</h2>
                  <HabitCards env={viewEnv} />
                </section>
                <section className="ld-section">
                  <h2>{t("upcoming")}</h2>
                  {range
                    .filter(
                      (x: any) =>
                        x.date > day &&
                        x.date <= shift(day, 14) &&
                        (x.event || x.reminderMinutes !== null || x.deadline) &&
                        !["done", "cancelled", "skipped"].includes(x.status),
                    )
                    .slice(0, 5)
                    .map((x: any) => (
                      <button
                        key={x.id + x.originalDate}
                        className="ld-upcoming"
                        onClick={() =>
                          openTask(
                            tasks.find((q: any) => q.id === x.id),
                            { occurrence: x },
                          )
                        }
                      >
                        <strong>{x.title}</strong>
                        <span>
                          {x.date}
                          {x.repeat.kind === "lunar"
                            ? " · " + lunarLabel(x.date)
                            : ""}
                        </span>
                      </button>
                    ))}
                </section>
              </aside>
            </div>
          </>
        );
      }
      if (tab === "projects") {
        if (!project)
          return (
            <>
              <div className="ld-actions">
                <Btn
                  primary
                  icon="plus"
                  onClick={() =>
                    setEditor({
                      type: "project",
                      item: {
                        title: "",
                        group: "",
                        goal: "",
                        deadline: "",
                        status: "todo",
                      },
                    })
                  }
                >
                  {t("addProject")}
                </Btn>
              </div>
              {projects.length ? (
                Array.from(
                  new Set(projects.map((p: any) => p.group || t("projects"))),
                ).map((group: any) => (
                  <section key={group} className="ld-section">
                    <h2>{group}</h2>
                    {projects
                      .filter((p: any) => (p.group || t("projects")) === group)
                      .map((p: any) => {
                        const list = tasks.filter(
                          (x: any) => x.projectId === p.id,
                        );
                        return (
                          <button
                            key={p.id}
                            className="ld-project-row"
                            onClick={() => setProject(p.id)}
                          >
                            <Icon name="projects" />
                            <span>
                              <strong>{p.title}</strong>
                              <small>
                                {t(p.status)}
                                {p.deadline ? " · " + p.deadline : ""}
                              </small>
                            </span>
                            <span className="ld-muted">
                              {
                                list.filter((x: any) => x.status === "done")
                                  .length
                              }
                              /{list.length}
                            </span>
                            <Icon name="chevron" size={16} />
                          </button>
                        );
                      })}
                  </section>
                ))
              ) : (
                <p className="ld-empty">{t("empty")}</p>
              )}
            </>
          );
        const list = tasks.filter((x: any) => x.projectId === project);
        return (
          <>
            <div className="ld-toolbar">
              <Btn onClick={() => setProject("")}>← {t("projects")}</Btn>
              <div className="ld-actions">
                <Btn aria-pressed={!board} onClick={() => setBoard(false)}>
                  {t("list")}
                </Btn>
                <Btn aria-pressed={board} onClick={() => setBoard(true)}>
                  {t("board")}
                </Btn>
                <Btn
                  onClick={() =>
                    setEditor({ type: "project", item: projectItem })
                  }
                >
                  {t("edit")}
                </Btn>
              </div>
            </div>
            <p className="ld-project-goal">{projectItem?.goal}</p>
            <Btn primary icon="plus" onClick={() => openTask()}>
              {t("addTask")}
            </Btn>
            {board ? (
              <div className="ld-board">
                {["todo", "doing", "done"].map((status) => (
                  <section key={status}>
                    <h3>
                      {t(status)} ·{" "}
                      {list.filter((x: any) => x.status === status).length}
                    </h3>
                    {taskRows(list.filter((x: any) => x.status === status))}
                  </section>
                ))}
              </div>
            ) : (
              taskRows(list)
            )}
          </>
        );
      }
      if (tab === "habits")
        return (
          <>
            <div className="ld-actions">
              <Btn primary icon="plus" onClick={() => openHabit(null)}>
                {t("addHabit")}
              </Btn>
            </div>
            <HabitCards full env={viewEnv} />
          </>
        );
      if (tab === "life")
        return (
          <>
            <div className="ld-toolbar">
              <Btn
                primary
                icon="plus"
                onClick={() => openTask({ area: "life", tag: lifeCategory })}
              >
                {t("addLife")}
              </Btn>
            </div>
            <p className="ld-help ld-life-template-help">
              {t("lifeTemplateHelp")}
            </p>
            <div className="ld-actions ld-life-templates">
              {["subscription", "payment", "shopping", "anniversary"].map(
                (k) => (
                  <Btn
                    key={k}
                    onClick={() =>
                      openTask({
                        title: t(k),
                        area: "life",
                        tag: t(k),
                        event: k === "anniversary",
                        steps: k === "shopping" ? [] : [],
                        repeat: {
                          kind: ["subscription", "payment"].includes(k)
                            ? "monthly"
                            : k === "anniversary"
                              ? "yearly"
                              : "none",
                          interval: 1,
                          days: [1],
                          missing: "last",
                          until: "",
                        },
                      })
                    }
                  >
                    {t(k)}
                  </Btn>
                ),
              )}
            </div>
            <div className="ld-actions ld-life-filters">
              <Btn
                aria-pressed={!lifeCategory}
                onClick={() => setLifeCategory("")}
              >
                {t("all")}
              </Btn>
              {[
                ...new Set(
                  tasks
                    .filter((x: any) => x.area === "life" && x.tag)
                    .map((x: any) => x.tag),
                ),
              ].map((tag: string) => (
                <Btn
                  key={tag}
                  aria-pressed={lifeCategory === tag}
                  onClick={() => setLifeCategory(tag)}
                >
                  {tag}
                </Btn>
              ))}
            </div>
            {section(
              lifeCategory || t("lifeTasks"),
              tasks.filter(
                (x: any) =>
                  x.area === "life" &&
                  (!lifeCategory || x.tag === lifeCategory),
              ),
            )}
          </>
        );
      if (tab === "calendar") return <Calendar env={viewEnv} />;
      if (tab === "review") return <Review env={viewEnv} />;
      if (tab === "settings") return <SettingsView env={viewEnv} />;
      if (tab === "trash")
        return (
          <>
            <p className="ld-muted">{t("recover")}</p>
            {["projects", "tasks", "habits", "reviews", "focusLogs"].flatMap(
              (c) =>
                data[c]
                  .filter((x: any) => x.deletedAt)
                  .map((x: any) => (
                    <div className="ld-log" key={x.id}>
                      <span>
                        {x.title || x.date} · {t(c === "tasks" ? "todos" : c)}
                      </span>
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          run({ action: "restore", collection: c, id: x.id })
                        }
                      >
                        {t("restore")}
                      </Btn>
                    </div>
                  )),
            )}
          </>
        );
      return (
        <>
          <p className="ld-help">{t("inboxHelp")}</p>
          <section className="ld-section">
            <h2>
              {t("awaitingTriage")} · {inboxTasks(data).length}
            </h2>
            {inboxTasks(data).map((task: any) => (
              <InboxItem
                key={task.id}
                task={task}
                projects={projects.filter((p: any) => p.status !== "done")}
                act={act}
                busy={busy}
                onEdit={openTask}
                day={day}
              />
            ))}
            {!inboxTasks(data).length && (
              <p className="ld-help">{t("empty")}</p>
            )}
          </section>
          {section(
            t("organizedUnscheduled"),
            tasks.filter(
              (x: any) =>
                !x.date &&
                x.status !== "done" &&
                !inboxTasks(data).some((q: any) => q.id === x.id),
            ),
          )}
        </>
      );
    }
    const title =
      projectItem && tab === "projects"
        ? projectItem.title
        : tab === "today" && day !== today(timeZone)
          ? day
          : t(tab);
    return (
      <Ambient data={data}>
        <style>{css}</style>
        <div
          className={
            "ld-shell " +
            (collapsed ? "ld-collapsed " : "") +
            (ai ? "ld-spirit-open" : "")
          }
          tabIndex={-1}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.shiftKey &&
              e.key.toLowerCase() === "k" &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              setCaptureOpen(true);
            }
          }}
        >
          <nav className="ld-nav" aria-label={t("title")}>
            <div className="ld-brand">
              <Icon name="review" size={22} />
              {!collapsed && <span>{t("title")}</span>}
            </div>
            <button
              className="ld-nav-add"
              ref={captureButton}
              aria-label={t("quickCapture")}
              aria-expanded={captureOpen}
              aria-controls="ld-quick-capture"
              aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
              title={t("quickCapture") + " · ⌘/Ctrl+Shift+K"}
              onClick={() => setCaptureOpen(!captureOpen)}
            >
              <Icon name="plus" />
              {!collapsed && t("quickCapture")}
            </button>
            <div className="ld-nav-items">
              {[...NAV, "inbox"].map((n) => (
                <button
                  key={n}
                  className={tab === n ? "selected" : ""}
                  title={t(n)}
                  aria-current={tab === n ? "page" : undefined}
                  onClick={() => go(n)}
                >
                  <Icon name={n} />
                  {!collapsed && (
                    <span>
                      {t(n)}
                      {n === "inbox" && inboxTasks(data).length > 0
                        ? " · " + inboxTasks(data).length
                        : ""}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {!collapsed &&
              projects
                .filter(
                  (p: any) => p.status !== "done" && p.status !== "paused",
                )
                .slice(0, 6)
                .map((p: any) => (
                  <button
                    key={p.id}
                    className="ld-nav-project"
                    onClick={() => {
                      setTab("projects");
                      setProject(p.id);
                      setSearch("");
                    }}
                  >
                    <span className="ld-project-bullet" />
                    {p.title}
                  </button>
                ))}
            <div className="ld-nav-bottom">
              {["settings", "trash"].map((n) => (
                <button key={n} title={t(n)} onClick={() => go(n)}>
                  <Icon name={n} />
                  {!collapsed && t(n)}
                </button>
              ))}
              <button
                onClick={() => setCollapsed(!collapsed)}
                title={t(collapsed ? "expand" : "collapse")}
              >
                <Icon name="chevron" size={18} />
                {!collapsed && t("collapse")}
              </button>
            </div>
          </nav>
          <div className="ld-workspace">
            <div className="ld-toolbar-wrap">
              <div
                className="ld-page-top"
                role="region"
                aria-label={t("workspaceActions")}
              >
                <div className="ld-search">
                  <Icon name="search" size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("search")}
                    aria-label={t("search")}
                  />
                </div>
                <div className="ld-actions">
                  <select
                    className="ld-mood"
                    aria-label={t("mood")}
                    value={
                      data.settings.moodUntil &&
                      data.settings.moodUntil < today(timeZone)
                        ? "daily"
                        : data.settings.mood
                    }
                    onChange={(e) =>
                      run({
                        action: "settings",
                        item: { mood: e.target.value },
                      })
                    }
                  >
                    {["daily", "bright", "focus", "calm"].map((m) => (
                      <option key={m} value={m}>
                        {t(
                          m === "daily"
                            ? "moodDaily"
                            : m === "focus"
                              ? "moodFocus"
                              : m,
                        )}
                      </option>
                    ))}
                  </select>
                  <Btn aria-pressed={ai} onClick={() => setAi(!ai)}>
                    <SpiritIcon
                      size={32}
                      reducedMotion={data.settings.reduceMotion}
                    />
                    {t("spirit")}
                  </Btn>
                </div>
              </div>
              <QuickCapture
                open={captureOpen}
                resetToken={captureReset}
                onDetails={(draft: any, requestId: string) => {
                  setCaptureOpen(false);
                  openTask(draft, { fromCapture: true, requestId });
                }}
                onClose={() => {
                  setCaptureOpen(false);
                  captureButton.current?.focus();
                }}
                projects={projects.filter((p: any) => p.status !== "done")}
                act={act}
                busy={busy}
                onSaved={() => setMessage(t("saved"))}
                onDirty={(value: boolean) => {
                  setCaptureDirty(value);
                  if (value) reviewDrafts.set("quick-capture", "unsaved");
                  else reviewDrafts.delete("quick-capture");
                }}
              />
            </div>
            <main
              className={
                "ld-content " + (tab !== "today" ? "ld-not-today" : "")
              }
            >
              <div className="ld-top-timer">
                <Timer bar />
              </div>
              <header className="ld-page-heading">
                <div>
                  <div className="ld-eyebrow">
                    {tab === "today"
                      ? new Intl.DateTimeFormat(
                          ctx.locale.getLocale().active.startsWith("zh")
                            ? "zh-CN"
                            : "en",
                          {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            timeZone: "UTC",
                          },
                        ).format(new Date(day + "T12:00:00Z"))
                      : t("appSubtitle")}
                  </div>
                  <h1>{title}</h1>
                </div>
                <div className="ld-day-nav">
                  <button
                    aria-label="Previous day"
                    onClick={() =>
                      setDay(shift(day, tab === "review" ? -7 : -1))
                    }
                  >
                    ‹
                  </button>
                  <input
                    type="date"
                    value={day}
                    aria-label={t("date")}
                    onChange={(e) => {
                      if (e.target.value) setDay(e.target.value);
                    }}
                  />
                  <button
                    aria-label="Next day"
                    onClick={() => setDay(shift(day, tab === "review" ? 7 : 1))}
                  >
                    ›
                  </button>
                  <Btn onClick={() => setDay(today(timeZone))}>
                    {t("backToday")}
                  </Btn>
                </div>
              </header>
              {error && (
                <div className="ld-error" role="alert">
                  {error} <Btn onClick={() => void refresh()}>{t("retry")}</Btn>
                </div>
              )}
              {message && (
                <div className="ld-status" role="status">
                  {message}
                  <button
                    aria-label={t("close")}
                    onClick={() => setMessage("")}
                  >
                    ×
                  </button>
                  <button onClick={() => run({ action: "undo" })}>
                    {t("undo")}
                  </button>
                </div>
              )}
              {updateNotice && (
                <div className="ld-status" role="status">
                  {updateNotice}
                  <button
                    aria-label={t("close")}
                    onClick={() => setUpdateNotice("")}
                  >
                    ×
                  </button>
                </div>
              )}
              {Body()}
              <footer className="ld-footer">
                {t("local")} · {timeZone} · v{__LIFE_DESK_VERSION__}{" "}
                {updateView?.state?.kind === "available" && (
                  <button
                    className="ld-update-badge"
                    onClick={() => {
                      setTab("settings");
                      setTimeout(
                        () =>
                          document.getElementById("ld-update")?.scrollIntoView({
                            block: "start",
                            behavior: "smooth",
                          }),
                        60,
                      );
                    }}
                  >
                    {t("updateAvailable")}
                  </button>
                )}
                <button onClick={() => void refresh()}>{t("retry")}</button>
              </footer>
            </main>
          </div>
          <SpiritPanel
            open={ai}
            onClose={() => setAi(false)}
            reducedMotion={data.settings.reduceMotion}
            onBusyChange={(value: boolean) => {
              spiritBusyRef.current = value;
            }}
          />
        </div>
        {editor && (
          <Editor
            editor={editor}
            close={() => {
              const fromCapture = editor.fromCapture;
              setEditor(null);
              if (fromCapture) {
                setCaptureOpen(true);
              }
            }}
            onSaved={() => {
              if (editor.fromCapture) {
                setCaptureReset((value) => value + 1);
                setCaptureDirty(false);
                reviewDrafts.delete("quick-capture");
              }
              setEditor(null);
              if (editor.fromCapture) captureButton.current?.focus();
            }}
            run={run}
            data={data}
            day={day}
            busy={busy}
          />
        )}
      </Ambient>
    );
  }
  function Editor({
    editor,
    close,
    onSaved = close,
    run,
    data,
    day,
    busy,
  }: any) {
    const type = editor.type;
    const [item, setItem] = useState<any>(structuredClone(editor.item));
    const [scope, setScope] = useState(editor.occurrence ? "single" : "series");
    const [occ, setOcc] = useState({ ...editor.occurrence });
    const [preview, setPreview] = useState<string[]>([]);
    const [localError, setLocalError] = useState("");
    const [steps, setSteps] = useState(
      item.steps?.map((x: any) => x.title).join("\n") || "",
    );
    const latestRule = item.rules?.at(-1);
    const [rule, setRule] = useState<any>(
      latestRule
        ? { ...latestRule, effective: item.id ? day : latestRule.effective }
        : null,
    );
    const dirty = useRef(false);
    const submissionId = useRef(editor.requestId || uid());
    const change = (k: string, v: any) => {
      submissionId.current = uid();
      dirty.current = true;
      setItem((old: any) => ({ ...old, [k]: v }));
    };
    const changeRule = (k: string, v: any) => {
      dirty.current = true;
      setRule((r: any) => ({ ...r, [k]: v }));
    };
    const changeRepeat = (k: string, v: any) =>
      change("repeat", { ...item.repeat, [k]: v });
    const onClose = () => {
      if (!dirty.current || window.confirm(t("dirty"))) close();
    };
    const input = (k: string, kind = "text", props: any = {}) => (
      <input
        type={kind}
        value={item[k] ?? ""}
        onChange={(e) =>
          change(k, kind === "number" ? Number(e.target.value) : e.target.value)
        }
        {...props}
      />
    );
    const options = (k: string, values: string[], labels?: string[]) => (
      <select value={item[k]} onChange={(e) => change(k, e.target.value)}>
        {values.map((v, i) => (
          <option key={v} value={v}>
            {t(labels?.[i] || v)}
          </option>
        ))}
      </select>
    );
    const repeat = item.repeat || { kind: "none" };
    const repeatField = (k: string, values: string[], labels?: string[]) => (
      <select
        value={repeat[k]}
        onChange={(e) => changeRepeat(k, e.target.value)}
      >
        {values.map((v, i) => (
          <option key={v} value={v}>
            {t(labels?.[i] || v)}
          </option>
        ))}
      </select>
    );
    const weekdayButtons = (
      days: number[],
      onChange: (v: number[]) => void,
    ) => (
      <div className="ld-days">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <button
            type="button"
            key={d}
            aria-pressed={days.includes(d)}
            onClick={() =>
              onChange(
                days.includes(d) ? days.filter((x) => x !== d) : [...days, d],
              )
            }
          >
            {new Intl.DateTimeFormat(
              ctx.locale.getLocale().active.startsWith("zh") ? "zh" : "en",
              { weekday: "narrow", timeZone: "UTC" },
            ).format(
              new Date(
                "2026-11-" +
                  String(d === 0 ? 15 : 8 + d).padStart(2, "0") +
                  "T12:00:00Z",
              ),
            )}
          </button>
        ))}
      </div>
    );
    async function submit(e: any) {
      e.preventDefault();
      setLocalError("");
      try {
        let result;
        if (type === "task") {
          if (editor.occurrence && scope === "single") {
            result = await run({
              action: "occurrence",
              id: item.id,
              originalDate: editor.occurrence.originalDate,
              date: occ.date,
              time: occ.time,
              status: occ.status,
            });
          } else {
            const normalized = {
              ...item,
              steps: steps
                .split("\n")
                .map((title, i) => ({
                  id: item.steps?.[i]?.id || uid(),
                  title: title.trim(),
                  done: item.steps?.[i]?.done || false,
                }))
                .filter((x) => x.title),
            };
            result = await run(
              editor.occurrence && scope === "future"
                ? {
                    action: "splitSeries",
                    id: item.id,
                    originalDate: editor.occurrence.originalDate,
                    item: normalized,
                  }
                : {
                    action: "save",
                    collection: "tasks",
                    id: item.id,
                    version: item.version,
                    requestId: submissionId.current,
                    item: normalized,
                  },
            );
          }
        } else if (type === "habit") {
          const rules = item.rules.filter(
            (r: any) => r.effective !== rule.effective,
          );
          rules.push(rule);
          result = await run({
            action: "save",
            collection: "habits",
            id: item.id,
            version: item.version,
            item: {
              ...item,
              rules,
              reviewLinked: rule.mode === "daily" && item.reviewLinked,
            },
          });
        } else
          result = await run({
            action: "save",
            collection: "projects",
            id: item.id,
            version: item.version,
            item,
          });
        if (result) onSaved();
      } catch (e) {
        setLocalError(e.message);
      }
    }
    return (
      <Modal
        title={t(
          item.id
            ? "edit"
            : type === "task"
              ? "addTask"
              : type === "habit"
                ? "addHabit"
                : "addProject",
        )}
        onClose={onClose}
      >
        <form onSubmit={submit}>
          {editor.occurrence && (
            <div className="ld-scope">
              <Field label={t("editSeries")}>
                <select
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value);
                    if (e.target.value === "future") {
                      change("date", editor.occurrence.date);
                    }
                  }}
                >
                  <option value="single">{t("single")}</option>
                  {item.repeat?.kind !== "none" &&
                    item.repeat?.kind !== "completion" && (
                      <option value="future">{t("future")}</option>
                    )}
                </select>
              </Field>
              <p className="ld-help">
                {t("originalDate")} · {editor.occurrence.originalDate}
              </p>
            </div>
          )}
          {editor.occurrence && scope === "single" ? (
            <div className="ld-form">
              <Field label={t("date")}>
                <input
                  type="date"
                  required
                  value={occ.date}
                  onChange={(e) => {
                    dirty.current = true;
                    setOcc({ ...occ, date: e.target.value });
                  }}
                />
              </Field>
              <Field label={t("time")}>
                <input
                  type="time"
                  value={occ.time || ""}
                  onChange={(e) => {
                    dirty.current = true;
                    setOcc({ ...occ, time: e.target.value });
                  }}
                />
              </Field>
              <Field label={t("status")}>
                <select
                  value={occ.status}
                  onChange={(e) => {
                    dirty.current = true;
                    setOcc({ ...occ, status: e.target.value });
                  }}
                >
                  {["todo", "doing", "done", "skipped", "cancelled"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label={t("name")}>
                <input value={item.title} readOnly />
              </Field>
            </div>
          ) : (
            <div className="ld-form">
              <Field label={t("name")} wide>
                {input("title", "text", {
                  required: true,
                  maxLength: 200,
                  autoFocus: true,
                })}
              </Field>
              {type === "project" && (
                <>
                  <Field label={t("group")}>{input("group")}</Field>
                  <Field label={t("deadline")}>
                    {input("deadline", "date")}
                  </Field>
                  <Field label={t("status")}>
                    {options("status", ["todo", "doing", "done", "paused"])}
                  </Field>
                  <Field label={t("goal")} wide>
                    <textarea
                      value={item.goal}
                      onChange={(e) => change("goal", e.target.value)}
                      rows={4}
                    />
                  </Field>
                </>
              )}
              {type === "habit" && (
                <>
                  <Field label={t("habitMode")}>
                    <select
                      value={rule.mode}
                      onChange={(e) => changeRule("mode", e.target.value)}
                    >
                      {["daily", "quantity", "weekly"].map((m) => (
                        <option key={m} value={m}>
                          {t(m)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("effective")}>
                    <input
                      type="date"
                      required
                      value={rule.effective}
                      min={item.id ? day : undefined}
                      onChange={(e) => changeRule("effective", e.target.value)}
                    />
                  </Field>
                  {rule.mode !== "daily" && (
                    <Field label={t("target")}>
                      <input
                        type="number"
                        required
                        min="1"
                        max={rule.mode === "weekly" ? 7 : 1000000}
                        value={rule.target}
                        onChange={(e) =>
                          changeRule("target", Number(e.target.value))
                        }
                      />
                    </Field>
                  )}
                  {rule.mode === "quantity" && (
                    <Field label={t("unit")}>
                      <input
                        value={rule.unit}
                        onChange={(e) => changeRule("unit", e.target.value)}
                      />
                    </Field>
                  )}
                  {rule.mode !== "weekly" && (
                    <Field label={t("days")} wide>
                      {weekdayButtons(rule.days, (v) => changeRule("days", v))}
                    </Field>
                  )}
                  <Field label={t("period")}>
                    {options("period", ["any", "morning", "evening"])}
                  </Field>
                  <label className="ld-check-label">
                    <input
                      type="checkbox"
                      checked={rule.paused}
                      onChange={(e) => changeRule("paused", e.target.checked)}
                    />
                    {t("pause")}
                  </label>
                  {rule.mode === "daily" && (
                    <details className="ld-wide ld-review-link">
                      <summary>{t("reviewLinkOptions")}</summary>
                      <label className="ld-check-label">
                        <input
                          type="checkbox"
                          checked={item.reviewLinked}
                          onChange={(e) =>
                            change("reviewLinked", e.target.checked)
                          }
                        />
                        {t("reviewLinkLabel")}
                      </label>
                      <p className="ld-help">{t("reviewLinkHelp")}</p>
                    </details>
                  )}
                  <p className="ld-help ld-wide">{t("habitHint")}</p>
                </>
              )}
              {type === "task" && (
                <details
                  className="ld-wide ld-advanced"
                  open={
                    !!item.id ||
                    repeat.kind !== "none" ||
                    !!item.date ||
                    !!item.projectId ||
                    item.area === "life"
                  }
                >
                  <summary>{t("advanced")}</summary>
                  <div className="ld-form">
                    <Field label={t("projects")}>
                      <select
                        value={item.projectId}
                        onChange={(e) => {
                          change("projectId", e.target.value);
                          if (e.target.value) change("area", "work");
                        }}
                      >
                        <option value="">{t("noProject")}</option>
                        {data.projects
                          .filter((x: any) => !x.deletedAt)
                          .map((p: any) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label={t("group")}>
                      {options(
                        "area",
                        ["inbox", "work", "life"],
                        ["inboxArea", "work", "lifeArea"],
                      )}
                    </Field>
                    <Field label={t("date")}>{input("date", "date")}</Field>
                    <Field label={t("deadline")}>
                      {input("deadline", "date")}
                    </Field>
                    <Field label={t("time")}>{input("time", "time")}</Field>
                    <Field label={t("estimatedTomatoes")}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.pomodoros || 0}
                        onChange={(e) =>
                          change("pomodoros", Number(e.target.value))
                        }
                      />
                      <small className="ld-help">
                        {t("tomatoEstimateHint")}
                      </small>
                    </Field>
                    <Field label={t("minutes")}>
                      {input("minutes", "number", { min: 0, max: 1440 })}
                    </Field>
                    <Field label={t("status")}>
                      {options("status", ["todo", "doing", "done"])}
                    </Field>
                    <Field
                      label={t(item.area === "life" ? "lifeCategory" : "tag")}
                    >
                      <input
                        value={item.tag}
                        list="ld-life-categories"
                        placeholder={t("lifeCategoryPlaceholder")}
                        maxLength={60}
                        onChange={(e) => change("tag", e.target.value)}
                      />
                      <datalist id="ld-life-categories">
                        {[
                          ...new Set(
                            data.tasks
                              .filter(
                                (x: any) =>
                                  !x.deletedAt && x.area === "life" && x.tag,
                              )
                              .map((x: any) => x.tag),
                          ),
                        ].map((tag: string) => (
                          <option key={tag} value={tag} />
                        ))}
                      </datalist>
                    </Field>
                    <label className="ld-check-label">
                      <input
                        type="checkbox"
                        checked={!!item.priorityDate}
                        onChange={(e) =>
                          change("priorityDate", e.target.checked ? day : "")
                        }
                      />
                      {t("priority")}
                    </label>
                    <label className="ld-check-label">
                      <input
                        type="checkbox"
                        checked={item.event}
                        onChange={(e) => change("event", e.target.checked)}
                      />
                      {t("event")}
                    </label>
                    <Field label={t("steps")} wide>
                      <textarea
                        rows={3}
                        value={steps}
                        onChange={(e) => {
                          dirty.current = true;
                          setSteps(e.target.value);
                        }}
                      />
                    </Field>
                    {item.steps?.length > 0 && (
                      <div className="ld-wide">
                        {item.steps.map((step: any, i: number) => (
                          <label key={step.id} className="ld-check-label">
                            <input
                              type="checkbox"
                              checked={step.done}
                              onChange={(e) =>
                                change(
                                  "steps",
                                  item.steps.map((s: any, j: number) =>
                                    j === i
                                      ? { ...s, done: e.target.checked }
                                      : s,
                                  ),
                                )
                              }
                            />
                            {step.title}
                          </label>
                        ))}
                      </div>
                    )}
                    <Field label={t("repeats")}>
                      <select
                        value={repeat.kind}
                        onChange={(e) => changeRepeat("kind", e.target.value)}
                      >
                        {[
                          "none",
                          "daily",
                          "weekly",
                          "monthly",
                          "yearly",
                          "lunar",
                          "completion",
                        ].map((k) => (
                          <option key={k} value={k}>
                            {t(
                              k === "daily"
                                ? "repeatDaily"
                                : k === "weekly"
                                  ? "repeatWeekly"
                                  : k,
                            )}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {repeat.kind !== "none" && (
                      <>
                        <Field label={t("interval")}>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={repeat.interval || 1}
                            onChange={(e) =>
                              changeRepeat("interval", Number(e.target.value))
                            }
                          />
                        </Field>
                        <Field label={t("until")}>
                          <input
                            type="date"
                            value={repeat.until || ""}
                            onChange={(e) =>
                              changeRepeat("until", e.target.value)
                            }
                          />
                        </Field>
                        {repeat.kind === "weekly" && (
                          <Field label={t("days")} wide>
                            {weekdayButtons(repeat.days || [1], (v) =>
                              changeRepeat("days", v),
                            )}
                          </Field>
                        )}
                        {repeat.kind === "monthly" && (
                          <Field label={t("monthMode")}>
                            {repeatField(
                              "monthMode",
                              ["date", "lastWeekday"],
                              ["monthDate", "lastWeekday"],
                            )}
                          </Field>
                        )}
                        {repeat.kind === "completion" && (
                          <Field label={t("unit")}>
                            {repeatField(
                              "unit",
                              ["days", "months", "years"],
                              ["daysUnit", "monthsUnit", "yearsUnit"],
                            )}
                          </Field>
                        )}
                        {repeat.kind === "lunar" && (
                          <>
                            <Field label={t("month")}>
                              <input
                                type="number"
                                min="1"
                                max="12"
                                value={repeat.month || 1}
                                onChange={(e) =>
                                  changeRepeat("month", Number(e.target.value))
                                }
                              />
                            </Field>
                            <Field label={t("day")}>
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={repeat.day || 1}
                                onChange={(e) =>
                                  changeRepeat("day", Number(e.target.value))
                                }
                              />
                            </Field>
                            <Field label={t("leap")}>
                              {repeatField("leap", ["regular", "only", "both"])}
                            </Field>
                            {repeat.leap === "only" && (
                              <Field label={t("leapFallback")}>
                                {repeatField(
                                  "leapFallback",
                                  ["regular", "skip"],
                                  ["fallbackRegular", "skipYear"],
                                )}
                              </Field>
                            )}
                          </>
                        )}
                        {["monthly", "yearly", "lunar"].includes(
                          repeat.kind,
                        ) && (
                          <Field label={t("missing")}>
                            {repeatField(
                              "missing",
                              ["last", "skip"],
                              ["last", "skipYear"],
                            )}
                          </Field>
                        )}
                        <div className="ld-wide">
                          <Btn
                            onClick={async () => {
                              try {
                                const v = await fetchAction({
                                  action: "preview",
                                  item,
                                  from: item.date || day,
                                });
                                setPreview(v.dates);
                                setLocalError("");
                              } catch (e) {
                                setLocalError(e.message);
                              }
                            }}
                          >
                            {t("preview")}
                          </Btn>
                          {preview.length > 0 && (
                            <p className="ld-help">
                              {t("previewDates")} · {preview.join(" · ")}
                            </p>
                          )}
                          <p className="ld-help">{t("repeatHint")}</p>
                        </div>
                      </>
                    )}
                    <Field label={t("reminder")}>
                      <input
                        type="number"
                        min="0"
                        max="527040"
                        value={item.reminderMinutes ?? ""}
                        onChange={(e) =>
                          change(
                            "reminderMinutes",
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                      />
                    </Field>
                    <Field label={t("reminderTime")}>
                      {input("reminderTime", "time")}
                    </Field>
                    <p className="ld-help ld-wide">{t("notifyHint")}</p>
                  </div>
                </details>
              )}
              {type !== "project" && (
                <Field label={t("note")} wide>
                  <textarea
                    value={item.note}
                    rows={3}
                    maxLength={10000}
                    onChange={(e) => change("note", e.target.value)}
                  />
                </Field>
              )}
            </div>
          )}
          {(localError || snapshot.error) && (
            <p className="ld-error" role="alert">
              {localError || snapshot.error}
            </p>
          )}
          <div className="ld-modal-footer">
            <div>
              {item.id && (
                <Btn
                  disabled={busy}
                  onClick={async () => {
                    if (window.confirm(t("confirmDelete"))) {
                      const collection = {
                        task: "tasks",
                        habit: "habits",
                        project: "projects",
                      }[type];
                      if (
                        await run({ action: "trash", collection, id: item.id })
                      )
                        close();
                    }
                  }}
                >
                  {t("remove")}
                </Btn>
              )}
            </div>
            <div className="ld-actions">
              <Btn onClick={onClose}>{t("cancel")}</Btn>
              <button
                type="submit"
                className="ld-btn ld-primary"
                disabled={busy}
              >
                {t("save")}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    );
  }
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "life-desk",
        order: 7,
        label: () => t("title"),
      },
      ({ size }: any) => <Icon name="review" size={size} />,
    ),
  );
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: "life-desk" }, App),
  );
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "life-desk-focus",
        order: 20,
        label: () => t("focus"),
      },
      () => {
        const { data } = useStore();
        return (
          <Ambient data={data}>
            <style>{css}</style>
            <Timer compact />
          </Ambient>
        );
      },
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      { name: "shell.overlay", id: "life-desk-reminders", order: 20 },
      () => {
        const { data } = useStore();
        return (
          <Ambient data={data}>
            <style>{css}</style>
            <Alerts />
            <Fullscreen />
          </Ambient>
        );
      },
    ),
  );
}
