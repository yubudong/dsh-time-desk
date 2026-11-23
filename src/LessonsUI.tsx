import * as React from "react";
import { WorkspacePeriodGrid, WorkspacePeriodNav } from "./WorkspaceViews";
import { workspacePeriod, lessonViewRows } from "./workspace-views.js";
import { createLessonDraftStore } from "./lesson-drafts.js";
import { monday, shift, today, weekday } from "./dates.js";
import {
  lessonAccount,
  lessonExpiring,
  lessonOccurrences,
  lessonScheduleLabel,
  lessonStats,
  lessonSummary,
  lessonTermAt,
  lessonTerms,
  lessonTimeLabel,
  lessonWeeklyLabel,
  lessonScheduleAt,
  lessonTimeFor,
  lessonScheduleSignature,
} from "./lessons.js";
const { useState, useEffect, useRef } = React;
type LessonEnv = {
  data: any;
  day: string;
  busy: boolean;
  act: (a: any) => Promise<any>;
  openLesson: (v: any) => void;
  refresh?: () => Promise<any>;
};
type LessonProps = { modal: any; env: LessonEnv; close: () => void };
export function createLessonsUI({
  t,
  Btn,
  Modal,
  Field,
  Icon,
  drafts = new Map(),
}: any) {
  let storage;
  try {
    storage = window.localStorage;
  } catch {}
  const draftStore = createLessonDraftStore(storage);
  function useFormDraft(modal: any, env: LessonEnv, close: () => void) {
    const lessonId = modal.lessonId || modal.lesson?.id || "new";
    const key =
      "lifeDesk:lessonDraft:v1:" +
      env.data.deviceId +
      ":" +
      [
        modal.type,
        modal.mode || "",
        lessonId,
        modal.term?.id ||
          modal.sessionId ||
          modal.originalDate ||
          modal.date ||
          "",
      ].join(":");
    const termId =
      modal.term?.id ||
      (modal.type === "editor" && modal.lesson?.mode === "term"
        ? (
            lessonSummary(env.data, modal.lesson, env.day).currentTerm ||
            lessonTerms(env.data, lessonId).at(-1)
          )?.id
        : "");
    const currentBase = () => ({
      epoch: env.data.dataEpoch || 0,
      lesson:
        env.data.lessons.find((x: any) => x.id === lessonId && !x.deletedAt)
          ?.version || 0,
      term:
        env.data.lessonTerms.find(
          (x: any) =>
            x.id === (ref.current?.values?.term?.id || termId) && !x.deletedAt,
        )?.version || 0,
      session:
        env.data.lessonSessions.find(
          (x: any) =>
            !x.deletedAt &&
            x.lessonId === lessonId &&
            (modal.sessionId
              ? x.id === modal.sessionId
              : modal.originalDate && x.originalDate === modal.originalDate),
        )?.version || 0,
    });
    const ref = useRef<any>(null);
    if (!ref.current)
      ref.current = draftStore.read(key) || {
        format: 1,
        values: {},
        base: currentBase(),
        requestId: crypto.randomUUID(),
        dirty: false,
      };
    const [, tick] = useState(0);
    const pending = useRef(false);
    const durable = useRef(!drafts.has(key));
    const persist = () => {
      durable.current = draftStore.put(key, ref.current);
      if (ref.current.dirty) drafts.set(key, "unsaved");
    };
    useEffect(() => {
      if (ref.current.dirty) drafts.set(key, "unsaved");
      return () => {
        if (durable.current) drafts.delete(key);
      };
    }, [key]);
    function useField(slot: string, initial: any) {
      const [value, setValue] = useState(() => {
        if (!Object.hasOwn(ref.current.values, slot))
          ref.current.values[slot] = structuredClone(initial);
        return structuredClone(ref.current.values[slot]);
      });
      const set = (next: any) => {
        if (env.busy || pending.current) return;
        const v =
          typeof next === "function" ? next(ref.current.values[slot]) : next;
        ref.current.values[slot] = v;
        ref.current.dirty = true;
        ref.current.requestId = crypto.randomUUID();
        persist();
        setValue(v);
      };
      return [value, set] as const;
    }
    const clear = () => {
      draftStore.remove(key);
      drafts.delete(key);
      ref.current.dirty = false;
    };
    const act = async (a: any) => {
      if (pending.current || env.busy) throw Error(t("loading"));
      pending.current = true;
      const action = {
        ...a,
        requestId: ref.current.requestId,
        dataEpoch: ref.current.base.epoch || 0,
      };
      if (a.action === "lesson") {
        action.version = ref.current.base.lesson;
        const latestLesson = env.data.lessons.find(
          (x: any) => x.id === a.id && !x.deletedAt,
        );
        if (latestLesson)
          action.item = {
            ...a.item,
            scheduleHistory: latestLesson.scheduleHistory,
          };
        if (a.term?.id)
          action.term = { ...a.term, version: ref.current.base.term };
      }
      if (a.action === "lessonSession" && a.command !== "add")
        action.version = ref.current.base.session;
      if (a.action === "lessonTerm" && a.item?.id)
        action.item = { ...a.item, version: ref.current.base.term };
      try {
        const result = await env.act(action);
        clear();
        return result;
      } catch (e) {
        void env.refresh?.();
        throw e;
      } finally {
        pending.current = false;
      }
    };
    const latest = currentBase();
    const relevant =
      modal.type === "editor"
        ? "lesson"
        : modal.type === "term" && modal.term
          ? "term"
          : modal.type === "session"
            ? "session"
            : null;
    const conflict =
      latest.epoch !== (ref.current.base.epoch || 0) ||
      (!!relevant && latest[relevant] !== ref.current.base[relevant]);
    return {
      useField,
      act,
      key,
      dirty: ref.current.dirty,
      durable: durable.current,
      conflict,
      close: () => {
        if (!env.busy && !pending.current) close();
      },
      discard: () => {
        if (!env.busy && !pending.current && window.confirm(t("dirty"))) {
          clear();
          close();
        }
      },
      rebase: () => {
        if (env.busy || pending.current) return;
        ref.current.base = latest;
        ref.current.requestId = crypto.randomUUID();
        persist();
        tick((x) => x + 1);
      },
    };
  }
  function DraftNotice({ form, modal, env }: any) {
    const latest = env.data.lessons.find(
      (x: any) => x.id === (modal.lessonId || modal.lesson?.id) && !x.deletedAt,
    );
    const latestSession = env.data.lessonSessions.find(
      (x: any) =>
        !x.deletedAt &&
        x.lessonId === (modal.lessonId || modal.lesson?.id) &&
        (modal.sessionId
          ? x.id === modal.sessionId
          : modal.originalDate && x.originalDate === modal.originalDate),
    );
    const latestTerm = env.data.lessonTerms.find(
      (x: any) => x.id === modal.term?.id && !x.deletedAt,
    );
    return (
      <div className="ld-lesson-draft-info">
        <p className="ld-help">
          {t(
            form.dirty
              ? form.durable
                ? "lessonDraftKept"
                : "lessonDraftMemoryOnly"
              : "lessonDraftIntro",
          )}
        </p>
        {form.conflict && (
          <div className="ld-review-conflict">
            <p className="ld-help">{t("lessonConflictDraft")}</p>
            {latest && (
              <p>
                {latest.title} · {lessonWeeklyLabel(latest, t)} · {latest.place}
              </p>
            )}
            {latestSession && (
              <p>
                {latestSession.date} {latestSession.time} ·{" "}
                {t(
                  "lessonStatus" +
                    (latestSession.status === "done"
                      ? "Done"
                      : latestSession.status === "skipped"
                        ? "Skipped"
                        : "Scheduled"),
                )}{" "}
                · {latestSession.deduction} {t("lessonUnit")}
              </p>
            )}
            {latestTerm && (
              <p>
                {latestTerm.start} – {latestTerm.end} · {latestTerm.note}
              </p>
            )}
            <div className="ld-actions">
              <Btn disabled={env.busy} onClick={form.rebase}>
                {t("reviewKeepDraft")}
              </Btn>
              <Btn disabled={env.busy} onClick={form.discard}>
                {t("lessonDiscardDraft")}
              </Btn>
            </div>
          </div>
        )}
        {form.dirty && !form.conflict && (
          <Btn disabled={env.busy} onClick={form.discard}>
            {t("lessonDiscardDraft")}
          </Btn>
        )}
      </div>
    );
  }
  const live = (data: any, key: string) =>
    data[key].filter((x: any) => !x.deletedAt);
  const lessonOf = (data: any, id: string) =>
    live(data, "lessons").find((x: any) => x.id === id);
  const statusText = (s: string) =>
    t(
      s === "done"
        ? "lessonStatusDone"
        : s === "skipped"
          ? "lessonStatusSkipped"
          : "lessonStatusScheduled",
    );
  const modeText = (m: string) =>
    t(
      m === "term"
        ? "lessonModeTerm"
        : m === "credit"
          ? "lessonModeCredit"
          : "lessonModeNone",
    );
  const accountLine = (data: any, l: any, date: string) => {
    if (l.mode === "credit") {
      const a = lessonAccount(data, l);
      return t("lessonRemaining") + " " + a.balance + " " + t("lessonUnit");
    }
    if (l.mode === "term") {
      const s = lessonSummary(data, l, date);
      if (!s.terms.length) return t("lessonNoTerm");
      if (s.expired) return t("lessonExpired");
      if (s.termStatus === "upcoming")
        return t("lessonTermNotStarted") + " · " + s.currentTerm.start;
      const stat = s.stats;
      return (
        (s.currentTerm
          ? t("lessonEndsInDays").replace("{n}", String(s.endsIn))
          : t("lessonExpired")) +
        " · " +
        t("lessonTermUsed")
          .replace("{n}", String(stat?.sessions || 0))
          .replace("{u}", String(stat?.units || 0))
      );
    }
    return "";
  };
  function LessonEditor({ modal, env, close }: LessonProps) {
    const draft = useFormDraft(modal, env, close);
    const lesson = modal.lesson;
    const existingTerm =
      modal.term ||
      (lesson?.mode === "term"
        ? lessonSummary(env.data, lesson, env.day).currentTerm ||
          lessonTerms(env.data, lesson.id).at(-1)
        : null);
    const [item, setItem] = draft.useField("item", {
      title: "",
      participant: "",
      place: "",
      note: "",
      mode: "none",
      weekdays: [],
      weekdayTimes: [],
      time: "",
      durationMinutes: 60,
      effective: env.day,
      until: "",
      reminderMinutes: null,
      defaultDeduction: 1,
      balanceWarnAt: null,
      expiryWarnDays: 30,
      ...(lesson || {}),
    });
    const [term, setTerm] = draft.useField("term", {
      id: existingTerm?.id || "",
      version: existingTerm?.version,
      start: existingTerm?.start || lesson?.effective || env.day,
      end: existingTerm?.end || "",
      purchased: existingTerm?.purchased ?? 0,
      amount: existingTerm?.amount ?? "",
      note: existingTerm?.note || "",
    });
    const [error, setError] = useState("");
    const [opening, setOpening] = draft.useField("opening", "");
    const currentDay = today(env.data.settings.timeZone);
    const [scheduleFrom, setScheduleFrom] = draft.useField(
      "from",
      [
        currentDay,
        env.day,
        lesson?.effective || "",
        lesson?.scheduleHistory?.at(-1)?.from || "",
      ]
        .sort()
        .at(-1),
    );
    const scheduleChanged =
      !!lesson &&
      lessonScheduleSignature(item) !== lessonScheduleSignature(lesson);
    const change = (k: string, v: any) =>
      setItem((x: any) => ({ ...x, [k]: v }));
    const toggleWeekday = (d: number) => {
      setItem((x: any) => {
        const on = x.weekdays.includes(d);
        const weekdays = on
          ? x.weekdays.filter((v: number) => v !== d)
          : [...x.weekdays, d];
        const weekdayTimes = (x.weekdayTimes || []).filter((v: any) =>
          weekdays.includes(v.weekday),
        );
        if (
          !on &&
          d !== undefined &&
          !weekdayTimes.some((v: any) => v.weekday === d)
        )
          weekdayTimes.push({ weekday: d, time: "" });
        return { ...x, weekdays, weekdayTimes };
      });
    };
    const participants = [
      ...new Set([
        ...live(env.data, "lessons")
          .map((x: any) => x.participant)
          .filter(Boolean),
        "我",
      ]),
    ];
    const save = async () => {
      setError("");
      if (!item.title.trim()) return setError(t("lessonTitleRequired"));
      if (item.mode === "term" && !term.end)
        return setError(t("lessonTermRequired"));
      if (
        opening !== "" &&
        (!Number.isFinite(Number(opening)) || Number(opening) < 0)
      )
        return setError(t("lessonOpeningInvalid"));
      const payload = {
        ...item,
        weekdayTimes: (item.weekdayTimes || []).filter(
          (x: any) => x.time && item.weekdays.includes(x.weekday),
        ),
      };
      if (
        scheduleChanged &&
        !window.confirm(
          t("lessonScheduleConfirm").replace("{date}", scheduleFrom),
        )
      )
        return;
      try {
        await draft.act({
          action: "lesson",
          ...(item.mode === "credit" && opening !== ""
            ? { opening: Number(opening) }
            : {}),
          id: item.id,
          version: item.version,
          item: payload,
          ...(lesson && scheduleChanged
            ? { from: scheduleFrom, confirm: true }
            : {}),
          ...(item.mode === "term"
            ? {
                term: {
                  ...term,
                  start: term.start || item.effective,
                  amount:
                    term.amount === "" || term.amount === null
                      ? null
                      : Number(term.amount),
                },
              }
            : {}),
        });
        close();
      } catch (e: any) {
        setError(e.message);
      }
    };
    return (
      <Modal
        title={item.id ? t("lessonEdit") : t("lessonAdd")}
        onClose={draft.close}
      >
        <DraftNotice form={draft} modal={modal} env={env} />
        <div className="ld-form">
          <Field label={t("lessonTitle")}>
            <input
              value={item.title}
              maxLength={200}
              autoFocus
              onChange={(e) => change("title", e.target.value)}
            />
          </Field>
          <Field label={t("lessonParticipant")}>
            <input
              list="ld-lesson-people"
              value={item.participant}
              maxLength={40}
              onChange={(e) => change("participant", e.target.value)}
            />
            <datalist id="ld-lesson-people">
              {participants.map((p: string) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label={t("lessonPlace")}>
            <input
              value={item.place}
              maxLength={200}
              onChange={(e) => change("place", e.target.value)}
            />
          </Field>
          <Field label={t("lessonMode")}>
            <select
              disabled={
                !!lesson &&
                ["lessonCharges", "lessonSessions", "lessonTerms"].some((k) =>
                  env.data[k].some((x: any) => x.lessonId === lesson.id),
                )
              }
              value={item.mode}
              onChange={(e) => change("mode", e.target.value)}
            >
              {["none", "credit", "term"].map((m) => (
                <option key={m} value={m}>
                  {modeText(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("lessonWeekdays")} wide>
            <div className="ld-days">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={item.weekdays.includes(d)}
                  onClick={() => toggleWeekday(d)}
                >
                  {t("weekdayShort" + d)}
                </button>
              ))}
            </div>
            <p className="ld-help">
              {item.weekdays.length
                ? t("lessonWeekdaysHint")
                : t("lessonOnceHint")}
            </p>
          </Field>
          {(item.weekdays.length > 1 ||
            (item.weekdayTimes || []).some(
              (x: any) => x.time && item.weekdays.includes(x.weekday),
            )) && (
            <div className="ld-field ld-wide">
              <span>{t("lessonWeekdayTimes")}</span>
              <div className="ld-weekday-times">
                {[1, 2, 3, 4, 5, 6, 0]
                  .filter((d) => item.weekdays.includes(d))
                  .map((d) => {
                    const current = (item.weekdayTimes || []).find(
                      (x: any) => x.weekday === d,
                    );
                    return (
                      <label className="ld-weekday-time" key={d}>
                        <span>{t("weekdayShort" + d)}</span>
                        <input
                          type="time"
                          value={current?.time || ""}
                          placeholder={item.time || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setItem((x: any) => ({
                              ...x,
                              weekdayTimes: [
                                ...(x.weekdayTimes || []).filter(
                                  (v: any) => v.weekday !== d,
                                ),
                                { weekday: d, time: value },
                              ],
                            }));
                          }}
                        />
                        <small>
                          {item.time
                            ? t("lessonUseDefaultTime").replace(
                                "{n}",
                                item.time,
                              )
                            : t("lessonNoDefaultTime")}
                        </small>
                      </label>
                    );
                  })}
              </div>
              <p className="ld-help">{t("lessonWeekdayTimesHint")}</p>
            </div>
          )}
          <Field
            label={t(
              item.weekdays.length > 1 ||
                (item.weekdayTimes || []).some(
                  (x: any) => x.time && item.weekdays.includes(x.weekday),
                )
                ? "lessonDefaultTime"
                : "lessonTime",
            )}
          >
            <input
              type="time"
              value={item.time}
              onChange={(e) => change("time", e.target.value)}
            />
          </Field>
          <Field label={t("lessonDuration")}>
            <input
              type="number"
              min={0}
              max={1440}
              value={item.durationMinutes}
              onChange={(e) =>
                change("durationMinutes", Number(e.target.value))
              }
            />
          </Field>
          <Field label={t("lessonEffective")}>
            <input
              type="date"
              value={item.effective}
              disabled={!!lesson}
              onChange={(e) => change("effective", e.target.value)}
            />
          </Field>
          {lesson && scheduleChanged && (
            <Field label={t("lessonScheduleFrom")} wide>
              <input
                type="date"
                value={scheduleFrom}
                min={
                  currentDay > lesson.effective ? currentDay : lesson.effective
                }
                onChange={(e) => setScheduleFrom(e.target.value)}
              />
              <p className="ld-help">
                {t("lessonSchedulePreserve")} {lessonWeeklyLabel(lesson, t)}
              </p>
            </Field>
          )}
          {item.mode !== "none" && (
            <Field label={t("lessonExpiryWarn")}>
              <select
                value={item.expiryWarnDays ?? "off"}
                onChange={(e) =>
                  change(
                    "expiryWarnDays",
                    e.target.value === "off" ? null : Number(e.target.value),
                  )
                }
              >
                <option value="off">{t("lessonReminderOff")}</option>
                {[0, 7, 14, 30, 60, 90].map((n) => (
                  <option key={n} value={n}>
                    {t("lessonExpiryBefore").replace("{n}", String(n))}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {item.mode !== "term" && (
            <Field label={t("lessonUntil")}>
              <input
                type="date"
                value={item.until || ""}
                onChange={(e) => change("until", e.target.value)}
              />
            </Field>
          )}
          <Field label={t("lessonReminder")}>
            <select
              value={item.reminderMinutes ?? "off"}
              onChange={(e) =>
                change(
                  "reminderMinutes",
                  e.target.value === "off" ? null : Number(e.target.value),
                )
              }
            >
              <option value="off">{t("lessonReminderOff")}</option>
              {[0, 10, 15, 30, 60, 120, 1440].map((n) => (
                <option key={n} value={n}>
                  {t("lessonBefore").replace("{n}", String(n))}
                </option>
              ))}
            </select>
          </Field>
          {item.mode === "credit" && (
            <>
              {!(
                item.id && lessonAccount(env.data, lesson).entries.length > 0
              ) && (
                <Field label={t("lessonOpening")}>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={0.5}
                    value={opening}
                    placeholder="0"
                    onChange={(e) => setOpening(e.target.value)}
                  />
                  <p className="ld-help">{t("lessonOpeningHint")}</p>
                </Field>
              )}
              <Field label={t("lessonDefaultDeduction")}>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  max={1000}
                  value={item.defaultDeduction}
                  onChange={(e) =>
                    change("defaultDeduction", Number(e.target.value))
                  }
                />
              </Field>
              <Field label={t("lessonBalanceWarn")}>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={item.balanceWarnAt ?? ""}
                  onChange={(e) =>
                    change(
                      "balanceWarnAt",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </Field>
            </>
          )}
          {item.mode === "term" && (
            <>
              <Field label={t("lessonTermStart")}>
                <input
                  type="date"
                  value={term.start}
                  onChange={(e) => setTerm({ ...term, start: e.target.value })}
                />
              </Field>
              <Field label={t("lessonTermEnd")}>
                <input
                  type="date"
                  value={term.end}
                  onChange={(e) => setTerm({ ...term, end: e.target.value })}
                />
              </Field>
              <Field label={t("lessonTermPurchased")}>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={term.purchased}
                  onChange={(e) =>
                    setTerm({ ...term, purchased: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label={t("lessonTermAmount")}>
                <input
                  type="number"
                  min={0}
                  value={term.amount}
                  onChange={(e) =>
                    setTerm({
                      ...term,
                      amount:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label={t("lessonTermNote")} wide>
                <input
                  value={term.note}
                  maxLength={3000}
                  onChange={(e) => setTerm({ ...term, note: e.target.value })}
                />
              </Field>
              <p className="ld-help ld-wide">{t("lessonTermHint")}</p>
            </>
          )}
          <Field label={t("lessonNote")} wide>
            <textarea
              rows={2}
              maxLength={3000}
              value={item.note}
              onChange={(e) => change("note", e.target.value)}
            />
          </Field>
        </div>
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        <div className="ld-actions">
          <Btn primary onClick={save} disabled={env.busy}>
            {t("save")}
          </Btn>
          <Btn onClick={draft.close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function SessionModal({ modal, env, close }: LessonProps) {
    const draft = useFormDraft(modal, env, close);
    const lesson = lessonOf(env.data, modal.lessonId);
    const occ0 = modal.occurrence;
    const [mode] = useState(modal.mode);
    const [date, setDate] = draft.useField(
      "date",
      modal.date || occ0?.date || "",
    );
    const [time, setTime] = draft.useField(
      "time",
      modal.time ?? occ0?.time ?? lesson?.time ?? "",
    );
    const [place, setPlace] = draft.useField(
      "place",
      modal.place ?? occ0?.place ?? lesson?.place ?? "",
    );
    const [note, setNote] = draft.useField("note", occ0?.note || "");
    const [deduction, setDeduction] = draft.useField(
      "deduction",
      occ0?.deduction ?? lesson?.defaultDeduction ?? 1,
    );
    const [confirmShort, setShort] = draft.useField("confirmShort", false),
      [confirmConflict, setConflict] = draft.useField("confirmConflict", false);
    const [error, setError] = useState("");
    const [skipCharged, setSkipCharged] = draft.useField("skipCharged", false);
    const account =
      lesson?.mode === "credit" ? lessonAccount(env.data, lesson) : null;
    if (!lesson) return null;
    const submit = async () => {
      try {
        setError("");
        const common: any = {
          action: "lessonSession",
          id: lesson.id,
          originalDate: modal.originalDate ?? "",
          sessionId: modal.sessionId || occ0?.sessionId || "",
        };
        if (mode === "complete")
          await draft.act({
            ...common,
            command: "complete",
            date,
            deduction,
            note,
            confirmShort,
          });
        else if (mode === "move")
          await draft.act({
            ...common,
            command: "save",
            date,
            time,
            place,
            note,
            confirmConflict,
          });
        else if (mode === "extra")
          await draft.act({
            ...common,
            command: "add",
            date,
            time,
            place,
            note,
            confirmConflict,
          });
        else if (mode === "skip")
          await draft.act({
            ...common,
            command: "skip",
            note,
            deduction: skipCharged ? deduction : 0,
            confirmShort,
          });
        else if (mode === "undo")
          await draft.act({ ...common, command: "undo" });
        else if (mode === "restore")
          await draft.act({ ...common, command: "restore" });
        else if (mode === "unskip")
          await draft.act({
            ...common,
            command: "save",
            date: occ0?.date || modal.originalDate,
            time:
              occ0?.time ??
              lessonTimeFor(lesson, modal.originalDate || occ0?.date),
            place: occ0?.place ?? lesson.place,
            note: "",
          });
        close();
      } catch (e: any) {
        setError(e.message);
      }
    };
    if (mode === "undo" || mode === "restore" || mode === "unskip")
      return (
        <Modal
          title={t(
            mode === "undo"
              ? "lessonUndoComplete"
              : mode === "unskip"
                ? "lessonUnskip"
                : "lessonRestore",
          )}
          onClose={draft.close}
        >
          <DraftNotice form={draft} modal={modal} env={env} />
          <p className="ld-help">
            {t(
              mode === "undo"
                ? "lessonUndoHint"
                : mode === "unskip"
                  ? "lessonUnskipHint"
                  : "lessonRestoreHint",
            )}
          </p>
          {error && (
            <p className="ld-error" role="alert">
              {error}
            </p>
          )}
          <div className="ld-actions">
            <Btn primary onClick={submit}>
              {t(
                mode === "undo"
                  ? "lessonUndoComplete"
                  : mode === "unskip"
                    ? "lessonUnskip"
                    : "lessonRestore",
              )}
            </Btn>
            <Btn onClick={draft.close}>{t("cancel")}</Btn>
          </div>
        </Modal>
      );
    return (
      <Modal
        title={lesson.title + " · " + (occ0?.date || date)}
        onClose={draft.close}
      >
        <DraftNotice form={draft} modal={modal} env={env} />
        <p className="ld-help">
          {t(
            mode === "complete"
              ? "lessonCompleteHint"
              : mode === "skip"
                ? "lessonSkipHint"
                : mode === "extra"
                  ? "lessonExtraHint"
                  : "lessonRescheduleHint",
          )}
        </p>
        {(mode === "complete" || mode === "move" || mode === "extra") && (
          <div className="ld-form">
            {(mode === "move" || mode === "extra") && (
              <Field label={t("lessonDate")}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
            )}
            {(mode === "move" || mode === "extra") && (
              <Field label={t("lessonTime")}>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Field>
            )}
            {(mode === "move" || mode === "extra") && (
              <Field label={t("lessonPlace")}>
                <input
                  value={place}
                  maxLength={200}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </Field>
            )}
            {mode === "complete" && (
              <Field
                label={t(
                  lesson.mode === "credit"
                    ? "lessonDeduction"
                    : "lessonRecordedUnits",
                )}
              >
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={0.5}
                  value={deduction}
                  onChange={(e) => setDeduction(Number(e.target.value))}
                />
              </Field>
            )}
            <Field label={t("lessonNote")} wide>
              <textarea
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        )}
        {mode === "complete" && account && (
          <p className="ld-help">
            {t("lessonRemaining")} {account.balance} ·{" "}
            {t("lessonThisCost").replace("{n}", String(deduction))}
          </p>
        )}
        {mode === "complete" && account && account.balance < deduction && (
          <label className="ld-check-label">
            <input
              type="checkbox"
              checked={confirmShort}
              onChange={(e) => setShort(e.target.checked)}
            />
            {t("lessonShortConfirm")}
          </label>
        )}
        {(mode === "move" || mode === "extra") && (
          <label className="ld-check-label">
            <input
              type="checkbox"
              checked={confirmConflict}
              onChange={(e) => setConflict(e.target.checked)}
            />
            {t("lessonConflictConfirm")}
          </label>
        )}
        {mode === "skip" && lesson.mode === "credit" && (
          <div className="ld-form">
            <label className="ld-check-label ld-wide">
              <input
                type="checkbox"
                checked={skipCharged}
                onChange={(e) => setSkipCharged(e.target.checked)}
              />
              {t("lessonChargeOnSkip")}
            </label>
            {skipCharged && (
              <Field label={t("lessonDeduction")}>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={0.5}
                  value={deduction}
                  onChange={(e) => setDeduction(Number(e.target.value))}
                />
              </Field>
            )}
            {skipCharged && account && account.balance < deduction && (
              <label className="ld-check-label ld-wide">
                <input
                  type="checkbox"
                  checked={confirmShort}
                  onChange={(e) => setShort(e.target.checked)}
                />
                {t("lessonShortConfirm")}
              </label>
            )}
          </div>
        )}
        {mode === "skip" && (
          <Field label={t("lessonNote")} wide>
            <textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        )}
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        <div className="ld-actions">
          <Btn primary onClick={submit} disabled={env.busy}>
            {t(
              mode === "complete"
                ? "lessonComplete"
                : mode === "skip"
                  ? "lessonSkip"
                  : "save",
            )}
          </Btn>
          <Btn onClick={draft.close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function ChargeModal({ modal, env, close }: LessonProps) {
    const draft = useFormDraft(modal, env, close);
    const lesson = lessonOf(env.data, modal.lessonId);
    const [kind, setKind] = draft.useField("kind", modal.kind || "purchase");
    const [date, setDate] = draft.useField("date", env.day);
    const [delta, setDelta] = draft.useField("delta", "");
    const [amount, setAmount] = draft.useField("amount", "");
    const [expiresOn, setExpiry] = draft.useField("expiresOn", "");
    const [note, setNote] = draft.useField("note", "");
    const [error, setError] = useState("");
    if (!lesson) return null;
    const save = async () => {
      try {
        setError("");
        const n = Number(delta);
        if (!n) return setError(t("lessonChargeDeltaRequired"));
        await draft.act({
          action: "lessonCharge",
          id: lesson.id,
          item: {
            date,
            kind,
            delta: n,
            amount: amount === "" ? null : Number(amount),
            expiresOn,
            note,
          },
        });
        close();
      } catch (e: any) {
        setError(e.message);
      }
    };
    return (
      <Modal
        title={t("lessonAddCharge") + " · " + lesson.title}
        onClose={draft.close}
      >
        <DraftNotice form={draft} modal={modal} env={env} />
        <div className="ld-form">
          <Field label={t("lessonChargeKind")}>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {["purchase", "gift", "opening", "adjust"].map((k) => (
                <option key={k} value={k}>
                  {t("lessonCharge" + k[0].toUpperCase() + k.slice(1))}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("lessonDate")}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={t("lessonChargeDelta")}>
            <input
              type="number"
              step={0.5}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </Field>
          <Field label={t("lessonChargeAmount")}>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          {(kind === "purchase" || kind === "gift") && (
            <Field label={t("lessonChargeExpires")}>
              <input
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
          )}
          <Field label={t("lessonChargeNote")} wide>
            <input
              value={note}
              maxLength={3000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <p className="ld-help">{t("lessonChargeHint")}</p>
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        <div className="ld-actions">
          <Btn primary onClick={save} disabled={env.busy}>
            {t("save")}
          </Btn>
          <Btn onClick={draft.close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function TermModal({ modal, env, close }: LessonProps) {
    const draft = useFormDraft(modal, env, close);
    const lesson = lessonOf(env.data, modal.lessonId);
    const terms = lesson ? lessonTerms(env.data, lesson.id) : [];
    const last = terms.at(-1);
    const editing = modal.term;
    const [start, setStart] = draft.useField(
      "start",
      editing?.start || (last ? shift(last.end, 1) : env.day),
    );
    const [end, setEnd] = draft.useField("end", editing?.end || "");
    const [purchased, setPurchased] = draft.useField(
      "purchased",
      editing?.purchased ?? 0,
    );
    const [amount, setAmount] = draft.useField("amount", editing?.amount ?? "");
    const [note, setNote] = draft.useField("note", editing?.note || "");
    const [error, setError] = useState("");
    if (!lesson) return null;
    const save = async () => {
      try {
        setError("");
        if (!end) return setError(t("lessonTermRequired"));
        await draft.act({
          action: "lessonTerm",
          id: lesson.id,
          command: editing ? "save" : "renew",
          item: {
            id: editing?.id,
            start,
            end,
            purchased,
            amount: amount === "" ? null : Number(amount),
            note,
          },
        });
        close();
      } catch (e: any) {
        setError(e.message);
      }
    };
    return (
      <Modal
        title={t("lessonRenew") + " · " + lesson.title}
        onClose={draft.close}
      >
        <DraftNotice form={draft} modal={modal} env={env} />
        <p className="ld-help">{t("lessonRenewHint")}</p>
        <div className="ld-form">
          <Field label={t("lessonTermStart")}>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label={t("lessonTermEnd")}>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
          <Field label={t("lessonTermPurchased")}>
            <input
              type="number"
              min={0}
              value={purchased}
              onChange={(e) => setPurchased(Number(e.target.value))}
            />
          </Field>
          <Field label={t("lessonTermAmount")}>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label={t("lessonTermNote")} wide>
            <input
              value={note}
              maxLength={3000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        <div className="ld-actions">
          <Btn primary onClick={save} disabled={env.busy}>
            {t("save")}
          </Btn>
          <Btn onClick={draft.close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function LessonDetail({ modal, env, close }: any) {
    const lesson = lessonOf(env.data, modal.lessonId);
    const [error, setError] = useState("");
    const period = lesson
      ? lessonSummary(env.data, lesson, env.day).currentTerm ||
        lessonTerms(env.data, lesson.id).at(-1)
      : null;
    const [historyFrom, setHistoryFrom] = useState(
      period && period.start <= env.day ? period.start : shift(env.day, -90),
    );
    const [historyTo, setHistoryTo] = useState(
      period && period.end < env.day ? period.end : env.day,
    );
    const [historyStatus, setHistoryStatus] = useState("all");
    const [historyPage, setHistoryPage] = useState(0);
    useEffect(() => setHistoryPage(0), [historyFrom, historyTo, historyStatus]);
    if (!lesson) return null;
    const summary = lessonSummary(env.data, lesson, env.day);
    const next = lessonOccurrences(
      env.data,
      lesson,
      env.day,
      shift(env.day, 45),
    ).slice(0, 8);
    const account = summary.account;
    const open = (v: any) => env.openLesson(v);
    const removeCharge = async (id: string) => {
      if (!window.confirm(t("lessonChargeRemoveConfirm"))) return;
      try {
        await env.act({
          action: "lessonCharge",
          command: "remove",
          id: lesson.id,
          removeId: id,
        });
      } catch (e: any) {
        setError(e.message);
      }
    };
    const removeExtra = async (sessionId: string) => {
      if (!window.confirm(t("lessonExtraDeleteConfirm"))) return;
      try {
        await env.act({
          action: "lessonSession",
          command: "remove",
          id: lesson.id,
          sessionId,
        });
      } catch (e: any) {
        setError(e.message);
      }
    };
    const removeLesson = async () => {
      if (!window.confirm(t("lessonDeleteConfirm"))) return;
      try {
        await env.act({
          action: "trash",
          collection: "lessons",
          id: lesson.id,
        });
        close();
      } catch (e: any) {
        setError(e.message);
      }
    };
    const renderRows = (rows: any[]) =>
      rows.map((x: any) => (
        <div className="ld-lesson-row" key={x.key}>
          <span>
            {x.date} {x.time}
          </span>
          <span>
            {x.status === "done" ? "✓ " : ""}
            {statusText(x.status)}
            {x.movedFrom
              ? " · " + t("lessonMovedFrom") + " " + x.movedFrom
              : ""}
          </span>
          <div className="ld-actions">
            {(x.status === "scheduled" || x.status === "skipped") &&
              !x.charged &&
              x.date <= today(env.data.settings.timeZone) && (
                <Btn
                  disabled={
                    env.busy ||
                    x.date > today(env.data.settings.timeZone) ||
                    x.charged
                  }
                  onClick={() =>
                    open({
                      type: "session",
                      mode: "complete",
                      lessonId: lesson.id,
                      originalDate: x.originalDate,
                      sessionId: x.sessionId,
                      occurrence: x,
                      date: x.date,
                    })
                  }
                >
                  {t("lessonComplete")}
                </Btn>
              )}
            {x.status === "scheduled" && (
              <Btn
                onClick={() =>
                  open({
                    type: "session",
                    mode: "move",
                    lessonId: lesson.id,
                    originalDate: x.originalDate,
                    sessionId: x.sessionId,
                    occurrence: x,
                    date: x.date,
                    time: x.time,
                    place: x.place,
                  })
                }
              >
                {t("lessonReschedule")}
              </Btn>
            )}
            {x.status === "scheduled" && (
              <Btn
                onClick={() =>
                  open({
                    type: "session",
                    mode: "skip",
                    lessonId: lesson.id,
                    originalDate: x.originalDate,
                    sessionId: x.sessionId,
                    occurrence: x,
                  })
                }
              >
                {t("lessonSkip")}
              </Btn>
            )}
            {x.status === "skipped" && !x.charged && (
              <Btn
                onClick={() =>
                  open({
                    type: "session",
                    mode: "unskip",
                    lessonId: lesson.id,
                    originalDate: x.originalDate,
                    sessionId: x.sessionId,
                    occurrence: x,
                  })
                }
              >
                {t("lessonUnskip")}
              </Btn>
            )}
            {x.movedFrom && x.status !== "done" && (
              <Btn
                onClick={() =>
                  open({
                    type: "session",
                    mode: "restore",
                    lessonId: lesson.id,
                    originalDate: x.originalDate,
                    sessionId: x.sessionId,
                  })
                }
              >
                {t("lessonRestore")}
              </Btn>
            )}
            {x.extra && x.status !== "done" && (
              <Btn onClick={() => removeExtra(x.sessionId)}>{t("delete")}</Btn>
            )}
            {(x.status === "done" || x.charged) && (
              <Btn
                onClick={() =>
                  open({
                    type: "session",
                    mode: "undo",
                    lessonId: lesson.id,
                    sessionId: x.sessionId,
                  })
                }
              >
                {t("lessonUndoComplete")}
              </Btn>
            )}
          </div>
          {x.status === "done" && (
            <small>
              {t("lessonAttendanceUnits").replace("{n}", String(x.deduction))}
            </small>
          )}
          {x.status === "skipped" && x.charged && (
            <small>
              {t("lessonSkippedCharge").replace("{n}", String(x.deduction))}
            </small>
          )}
          {!!x.changes?.length && (
            <details className="ld-lesson-changes">
              <summary>
                {t("lessonChangeHistory")} · {x.changes.length}
              </summary>
              {x.changes.map((event: any, i: number) => (
                <p className="ld-help" key={event.at + i}>
                  {event.at.slice(0, 10)} · {t("lessonAction" + event.action)} ·{" "}
                  {event.fromDate} {event.fromTime} → {event.date} {event.time}
                  {event.note ? " · " + event.note : ""}
                </p>
              ))}
            </details>
          )}
        </div>
      ));
    const span =
      (Date.parse(historyTo + "T00:00:00Z") -
        Date.parse(historyFrom + "T00:00:00Z")) /
      86400000;
    const validHistory = Number.isFinite(span) && span >= 0 && span <= 3660;
    const historyRows = validHistory
      ? lessonOccurrences(env.data, lesson, historyFrom, historyTo).filter(
          (x: any) =>
            historyStatus === "all" || historyStatus === "pending"
              ? historyStatus === "all" ||
                (x.status === "scheduled" &&
                  x.date <= today(env.data.settings.timeZone))
              : x.status === historyStatus,
        )
      : [];
    return (
      <Modal title={lesson.title} onClose={close}>
        <p className="ld-help">
          {lesson.participant || t("lessonNoParticipant")}
          {lesson.place ? " · " + lesson.place : ""}
        </p>
        <div className="ld-lesson-summary">
          <span>{modeText(lesson.mode)}</span>
          <span>{lessonWeeklyLabel(lesson, t)}</span>
        </div>
        {lesson.mode === "credit" && account && (
          <div className="ld-lesson-money">
            <strong>{account.balance}</strong> {t("lessonUnit")}
            <small>
              {t("lessonPurchased")} {account.purchased} · {t("lessonGifted")}{" "}
              {account.gifted} · {t("lessonUsed")} {account.netUsed}
            </small>
          </div>
        )}
        {lesson.mode === "term" && (
          <div className="ld-lesson-money">
            {summary.termStatus === "upcoming" ? (
              <>
                <strong>{t("lessonTermNotStarted")}</strong>
                <small>
                  {summary.currentTerm.start} – {summary.currentTerm.end}
                </small>
              </>
            ) : summary.currentTerm ? (
              <>
                <strong>{summary.endsIn}</strong> {t("lessonDaysLeft")}
                <small>
                  {summary.currentTerm.start} – {summary.currentTerm.end}
                </small>
              </>
            ) : (
              <>
                <strong>{t("lessonExpired")}</strong>
                <small>
                  {summary.terms.length ? summary.terms.at(-1).end : ""}
                </small>
              </>
            )}
            {summary.stats && (
              <small>
                {t("lessonTermUsed")
                  .replace("{n}", String(summary.stats.sessions))
                  .replace("{u}", String(summary.stats.units))}
              </small>
            )}
          </div>
        )}
        <div className="ld-actions">
          <Btn
            onClick={() =>
              open({
                type: "session",
                mode: "extra",
                lessonId: lesson.id,
                date: env.day,
              })
            }
          >
            {t("lessonAddExtra")}
          </Btn>
          <Btn onClick={() => open({ type: "editor", lesson })}>
            {t("edit")}
          </Btn>
        </div>
        <section className="ld-section">
          <h3>{t("lessonSchedule")}</h3>
          {next.length ? (
            renderRows(next)
          ) : (
            <p className="ld-help">{t("lessonNoUpcoming")}</p>
          )}
        </section>
        <section className="ld-section ld-lesson-history">
          <h3>{t("lessonAttendanceHistory")}</h3>
          <div className="ld-actions ld-history-filters">
            <label>
              {t("lessonHistoryFrom")}
              <input
                type="date"
                value={historyFrom}
                onChange={(e) => setHistoryFrom(e.target.value)}
              />
            </label>
            <label>
              {t("lessonHistoryTo")}
              <input
                type="date"
                value={historyTo}
                onChange={(e) => setHistoryTo(e.target.value)}
              />
            </label>
            <select
              aria-label={t("lessonHistoryStatus")}
              value={historyStatus}
              onChange={(e) => setHistoryStatus(e.target.value)}
            >
              {["all", "done", "pending", "skipped"].map((k) => (
                <option key={k} value={k}>
                  {t("lessonHistory" + k)}
                </option>
              ))}
            </select>
            {!!summary.terms.length && (
              <select
                aria-label={t("lessonTerms")}
                value=""
                onChange={(e) => {
                  const term = summary.terms.find(
                    (x: any) => x.id === e.target.value,
                  );
                  if (term) {
                    setHistoryFrom(term.start);
                    setHistoryTo(term.end);
                  }
                }}
              >
                <option value="">{t("lessonSelectTerm")}</option>
                {summary.terms.map((term: any) => (
                  <option key={term.id} value={term.id}>
                    {term.start} – {term.end}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="ld-help">{t("lessonHistoryHint")}</p>
          {!validHistory ? (
            <p className="ld-help">{t("lessonHistoryRange")}</p>
          ) : (
            <>
              <p className="ld-help">
                {historyRows.length} {t("lessonSessionCount")} ·{" "}
                {lessonStats(env.data, lesson, historyFrom, historyTo).units}{" "}
                {t("lessonUnit")}
              </p>
              {renderRows(
                historyRows.slice(historyPage * 25, (historyPage + 1) * 25),
              )}
              {!historyRows.length && (
                <p className="ld-help">{t("lessonNoHistory")}</p>
              )}
              {historyRows.length > 25 && (
                <div className="ld-actions">
                  <Btn
                    disabled={historyPage === 0}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    {t("lessonPrevPage")}
                  </Btn>
                  <span>
                    {historyPage + 1}/{Math.ceil(historyRows.length / 25)}
                  </span>
                  <Btn
                    disabled={(historyPage + 1) * 25 >= historyRows.length}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    {t("lessonNextPage")}
                  </Btn>
                </div>
              )}
            </>
          )}
        </section>
        {!!lesson.scheduleHistory?.length && (
          <section className="ld-section">
            <h3>{t("lessonScheduleVersions")}</h3>
            {lesson.scheduleHistory.map((rule: any) => (
              <p className="ld-help" key={rule.from}>
                {rule.from} · {lessonWeeklyLabel({ ...lesson, ...rule }, t)}
              </p>
            ))}
          </section>
        )}
        {lesson.mode === "credit" && account && (
          <section className="ld-section">
            <div className="ld-section-heading">
              <h3>{t("lessonLedger")}</h3>
              <Btn
                onClick={() => open({ type: "charge", lessonId: lesson.id })}
              >
                {t("lessonAddCharge")}
              </Btn>
            </div>
            {account.entries.length ? (
              account.entries.map((x: any) => (
                <div className="ld-lesson-row" key={x.id}>
                  <span>{x.date}</span>
                  <span>
                    {t(
                      "lessonCharge" +
                        x.kind[0].toUpperCase() +
                        x.kind.slice(1),
                    )}
                  </span>
                  <strong>
                    {x.delta > 0 ? "+" : ""}
                    {x.delta}
                  </strong>
                  <span>{x.note}</span>
                  {x.kind !== "use" && (
                    <Btn onClick={() => removeCharge(x.id)}>
                      {t("lessonChargeRemove")}
                    </Btn>
                  )}
                </div>
              ))
            ) : (
              <p className="ld-help">{t("lessonNoLedger")}</p>
            )}
          </section>
        )}
        {lesson.mode === "term" && (
          <section className="ld-section">
            <div className="ld-section-heading">
              <h3>{t("lessonTerms")}</h3>
              <Btn onClick={() => open({ type: "term", lessonId: lesson.id })}>
                {t("lessonRenew")}
              </Btn>
            </div>
            {summary.terms.map((x: any) => (
              <div className="ld-lesson-row" key={x.id}>
                <span>
                  {x.start} – {x.end}
                </span>
                <span>
                  {t("lessonTermUsed")
                    .replace(
                      "{n}",
                      String(
                        lessonStats(env.data, lesson, x.start, x.end).sessions,
                      ),
                    )
                    .replace(
                      "{u}",
                      String(
                        lessonStats(env.data, lesson, x.start, x.end).units,
                      ),
                    )}
                </span>
                <Btn
                  onClick={() =>
                    open({ type: "term", lessonId: lesson.id, term: x })
                  }
                >
                  {t("edit")}
                </Btn>
              </div>
            ))}
          </section>
        )}
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        <div className="ld-actions">
          <Btn onClick={removeLesson}>{t("delete")}</Btn>
          <Btn onClick={close}>{t("close")}</Btn>
        </div>
      </Modal>
    );
  }
  function LessonHub({ modal, env, close }: LessonProps) {
    if (!modal) return null;
    let body;
    if (modal.type === "editor")
      body = <LessonEditor modal={modal} env={env} close={close} />;
    if (modal.type === "session")
      body = <SessionModal modal={modal} env={env} close={close} />;
    if (modal.type === "charge")
      body = <ChargeModal modal={modal} env={env} close={close} />;
    if (modal.type === "term")
      body = <TermModal modal={modal} env={env} close={close} />;
    if (modal.type === "detail")
      body = <LessonDetail modal={modal} env={env} close={close} />;
    return (
      <fieldset
        className="ld-lesson-form-lock"
        disabled={env.busy}
        aria-busy={env.busy}
      >
        {body}
      </fieldset>
    );
  }
  function LessonQuickActions({ occurrence: x, env }: any) {
    const menu = useRef<HTMLDetailsElement>(null);
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
      if (!expanded) return;
      const outside = (e: PointerEvent) => {
        if (!menu.current?.contains(e.target as Node) && menu.current)
          menu.current.open = false;
      };
      document.addEventListener("pointerdown", outside);
      return () => document.removeEventListener("pointerdown", outside);
    }, [expanded]);
    const choose = (mode: string) => {
      if (menu.current) menu.current.open = false;
      env.openLesson(
        mode === "detail"
          ? { type: "detail", lessonId: x.lessonId }
          : {
              type: "session",
              mode,
              lessonId: x.lessonId,
              originalDate: x.originalDate,
              sessionId: x.sessionId,
              occurrence: x,
              date: x.date,
              time: x.time,
              place: x.place,
            },
      );
    };
    return (
      <div className="ld-lesson-quick-actions">
        {x.status === "scheduled" &&
          !x.charged &&
          x.date <= today(env.data.settings.timeZone) && (
            <Btn disabled={env.busy} onClick={() => choose("complete")}>
              {t("lessonComplete")}
            </Btn>
          )}
        <details
          ref={menu}
          className="ld-lesson-quick-menu"
          onToggle={(e) => setExpanded(e.currentTarget.open)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && menu.current?.open) {
              e.preventDefault();
              e.stopPropagation();
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            aria-label={
              t("lessonMoreActions") + " · " + x.title + " · " + x.date
            }
          >
            <Icon name="more" size={18} />
          </summary>
          <div
            className="ld-lesson-quick-menu-panel"
            role="group"
            aria-label={t("lessonMoreActions")}
          >
            {x.status === "scheduled" && (
              <>
                <Btn disabled={env.busy} onClick={() => choose("move")}>
                  {t("lessonReschedule")}
                </Btn>
                <Btn disabled={env.busy} onClick={() => choose("skip")}>
                  {t("lessonSkip")}
                </Btn>
              </>
            )}
            {(x.status === "done" || x.charged) && (
              <Btn disabled={env.busy} onClick={() => choose("undo")}>
                {t("lessonUndoComplete")}
              </Btn>
            )}
            {x.status === "skipped" && !x.charged && (
              <Btn disabled={env.busy} onClick={() => choose("unskip")}>
                {t("lessonUnskip")}
              </Btn>
            )}
            <Btn disabled={env.busy} onClick={() => choose("detail")}>
              {t("lessonViewDetail")}
            </Btn>
          </div>
        </details>
      </div>
    );
  }
  function TodayLessons({ env }: any) {
    const data = env.data,
      day = env.day;
    const lessons = live(data, "lessons");
    const rows = lessons.flatMap((l: any) =>
      lessonOccurrences(data, l, day, day),
    );
    return (
      <>
        {rows.length ? (
          rows
            .sort((a: any, b: any) =>
              (a.time || "99:99").localeCompare(b.time || "99:99"),
            )
            .map((x: any) => {
              const l = lessons.find((q: any) => q.id === x.lessonId);
              return (
                <div
                  className={
                    "ld-lesson-today " + (x.status === "done" ? "is-done" : "")
                  }
                  key={x.key}
                >
                  <button
                    className="ld-task-body"
                    onClick={() =>
                      env.openLesson({ type: "detail", lessonId: x.lessonId })
                    }
                  >
                    <span className="ld-task-title">
                      <span className="ld-lesson-time">
                        {x.time || t("allDay")}
                      </span>
                      {x.title}
                      {x.participant ? " · " + x.participant : ""}
                    </span>
                    <span className="ld-task-meta">
                      {statusText(x.status)}
                      {x.movedFrom
                        ? " · " + t("lessonMovedFrom") + " " + x.movedFrom
                        : ""}{" "}
                      {accountLine(data, l, day)}
                    </span>
                  </button>
                  <LessonQuickActions occurrence={x} env={env} />
                </div>
              );
            })
        ) : (
          <p className="ld-help">{t("lessonTodayEmpty")}</p>
        )}
        <div className="ld-actions">
          <Btn
            disabled={env.busy}
            onClick={() => env.openLesson({ type: "editor" })}
          >
            {t("lessonAdd")}
          </Btn>
        </div>
      </>
    );
  }
  function LessonsPage({ env }: any) {
    const data = env.data;
    const lessons = live(data, "lessons");
    const [person, setPerson] = useState("");
    const [view, setView] = useState("day");
    const people = [
      ...new Set(lessons.map((x: any) => x.participant).filter(Boolean)),
    ];
    const filtered = person
      ? lessons.filter((x: any) => x.participant === person)
      : lessons;
    const open = (v: any) => env.openLesson(v);
    const dayRows = lessonViewRows(data, filtered, env.day, env.day);
    const period = workspacePeriod(env.day, view);
    const periodRows = ["week", "month"].includes(view)
      ? lessonViewRows(data, filtered, period.from, period.to)
      : [];
    const openDetail = (x: any) => {
      env.setDay(x.date);
      open({ type: "detail", lessonId: x.lessonId });
    };
    const renderDayRow = (x: any) => (
      <div
        className={"ld-lesson-today " + (x.status === "done" ? "is-done" : "")}
        key={x.key}
      >
        <button className="ld-task-body" onClick={() => openDetail(x)}>
          <span className="ld-task-title">
            <span className="ld-lesson-time">{x.time || t("allDay")}</span>
            {x.status === "done" ? "✓ " : ""}
            {x.title}
            {x.participant ? " · " + x.participant : ""}
          </span>
          <span className="ld-task-meta">
            {statusText(x.status)}
            {x.place ? " · " + x.place : ""}
            {x.movedFrom
              ? " · " + t("lessonMovedFrom") + " " + x.movedFrom
              : ""}
          </span>
        </button>
        <LessonQuickActions occurrence={x} env={env} />
      </div>
    );
    const nextFor = (l: any) =>
      lessonOccurrences(data, l, env.day, shift(env.day, 45)).find(
        (x: any) => x.status === "scheduled",
      );
    return (
      <div className="ld-lessons-page">
        <div className="ld-toolbar">
          <div className="ld-actions">
            <Btn primary icon="plus" onClick={() => open({ type: "editor" })}>
              {t("lessonAdd")}
            </Btn>
          </div>
          {!!people.length && (
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">{t("lessonAllPeople")}</option>
              {people.map((p: any) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="ld-toolbar">
          <div
            className="ld-actions"
            role="group"
            aria-label={t("workspaceViews")}
          >
            {["day", "week", "month", "manage"].map((v) => (
              <Btn key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {t(v === "manage" ? "lessonManagement" : v + "View")}
              </Btn>
            ))}
          </div>
          {["week", "month"].includes(view) && (
            <WorkspacePeriodNav env={env} view={view} t={t} Btn={Btn} />
          )}
        </div>
        {(() => {
          const warnings = lessonExpiring(data, env.day).filter((x: any) =>
            filtered.some((l: any) => l.id === x.lessonId),
          );
          const low = filtered
            .filter(
              (l: any) =>
                l.mode === "credit" &&
                l.balanceWarnAt !== null &&
                lessonAccount(data, l).balance <= l.balanceWarnAt,
            )
            .map((l: any) => ({
              kind: "low",
              lessonId: l.id,
              title: l.title,
              balance: lessonAccount(data, l).balance,
              date: env.day,
            }));
          const list = [...low, ...warnings];
          return list.length ? (
            <section className="ld-section ld-lesson-alerts">
              <h2>{t("lessonAlerts")}</h2>
              {list.map((x: any, i: number) => (
                <button
                  className="ld-time-index"
                  key={x.kind + x.lessonId + x.date + i}
                  onClick={() => open({ type: "detail", lessonId: x.lessonId })}
                >
                  <span>{x.date}</span>
                  <span>{x.title}</span>
                  <small>
                    {x.kind === "low"
                      ? t("lessonLowBalance").replace("{n}", String(x.balance))
                      : x.kind === "term"
                        ? t("lessonTermExpiring").replace("{n}", String(x.days))
                        : t("lessonCreditExpiring").replace(
                            "{n}",
                            String(x.days),
                          )}
                  </small>
                </button>
              ))}
            </section>
          ) : null;
        })()}
        {view === "day" && (
          <>
            {!dayRows.length ? (
              <p className="ld-help">{t("lessonDayEmpty")}</p>
            ) : (
              [
                ["scheduled", "lessonPending"],
                ["done", "lessonStatusDone"],
                ["skipped", "lessonStatusSkipped"],
              ].map(([status, label]) => {
                const rows = dayRows.filter((x: any) => x.status === status);
                return rows.length ? (
                  <section className="ld-section" key={status}>
                    <h3>
                      {t(label)} · {rows.length}
                    </h3>
                    {rows.map(renderDayRow)}
                  </section>
                ) : null;
              })
            )}
          </>
        )}
        {["week", "month"].includes(view) && (
          <WorkspacePeriodGrid
            dates={period.dates}
            day={env.day}
            rows={periodRows}
            t={t}
            month={view === "month"}
            renderItem={(x: any) => (
              <button
                key={x.key}
                className={
                  "ld-workspace-period-item" +
                  (x.status === "done" ? " is-done" : "")
                }
                onClick={() => openDetail(x)}
              >
                <span>{x.time || t("allDay")}</span>
                <strong>
                  {x.status === "done" ? "✓ " : ""}
                  {x.title}
                </strong>
                <small>
                  {x.participant || ""} · {statusText(x.status)}
                  {x.movedFrom
                    ? " · " + t("lessonMovedFrom") + " " + x.movedFrom
                    : ""}
                </small>
              </button>
            )}
          />
        )}
        {view === "manage" && (
          <section className="ld-section">
            <div className="ld-section-heading">
              <h2>{t("lessonCourses")}</h2>
              <span className="ld-fold-count">{filtered.length}</span>
            </div>
            {filtered.length ? (
              <div className="ld-lesson-cards">
                {filtered.map((l: any) => {
                  const next = nextFor(l);
                  return (
                    <div className="ld-lesson-card" key={l.id}>
                      <button
                        className="ld-task-body"
                        onClick={() => open({ type: "detail", lessonId: l.id })}
                      >
                        <span className="ld-task-title">
                          {l.title}
                          {l.participant ? " · " + l.participant : ""}
                        </span>
                        <span className="ld-task-meta">
                          {lessonWeeklyLabel(l, t)}
                          {l.place ? " · " + l.place : ""}
                        </span>
                        <span className="ld-task-meta">
                          {modeText(l.mode)}
                          {accountLine(data, l, env.day)
                            ? " · " + accountLine(data, l, env.day)
                            : ""}
                        </span>
                        {next && (
                          <span className="ld-task-meta">
                            {t("lessonNext")} {next.date} {next.time}
                          </span>
                        )}
                      </button>
                      <div className="ld-actions">
                        <Btn
                          onClick={() =>
                            open({ type: "detail", lessonId: l.id })
                          }
                        >
                          {t("lessonDetail")}
                        </Btn>
                        <Btn
                          onClick={() => open({ type: "editor", lesson: l })}
                        >
                          {t("edit")}
                        </Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="ld-welcome">
                <Icon name="lessons" size={28} />
                <h2>{t("lessonEmptyTitle")}</h2>
                <p>{t("lessonEmptyText")}</p>
                <Btn primary onClick={() => open({ type: "editor" })}>
                  {t("lessonAdd")}
                </Btn>
              </div>
            )}
          </section>
        )}
      </div>
    );
  }
  return { LessonHub, LessonsPage, TodayLessons };
}
