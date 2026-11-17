import * as React from "react";
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
} from "./lessons.js";
const { useState, useEffect } = React;
export function createLessonsUI({ t, Btn, Modal, Field, Icon }: any) {
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
  function LessonEditor({ modal, env, close }: any) {
    const lesson = modal.lesson;
    const existingTerm =
      modal.term ||
      (lesson?.mode === "term"
        ? lessonSummary(env.data, lesson, env.day).currentTerm
        : null);
    const [item, setItem] = useState<any>({
      title: "",
      participant: "",
      place: "",
      note: "",
      mode: "none",
      weekdays: [],
      time: "",
      durationMinutes: 60,
      effective: env.day,
      until: "",
      reminderMinutes: null,
      defaultDeduction: 1,
      balanceWarnAt: null,
      ...(lesson || {}),
    });
    const [term, setTerm] = useState<any>({
      id: existingTerm?.id || "",
      start: existingTerm?.start || lesson?.effective || env.day,
      end: existingTerm?.end || "",
      purchased: existingTerm?.purchased ?? 0,
      amount: existingTerm?.amount ?? "",
      note: existingTerm?.note || "",
    });
    const [error, setError] = useState("");
    const change = (k: string, v: any) =>
      setItem((x: any) => ({ ...x, [k]: v }));
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
      try {
        await env.act({
          action: "lesson",
          id: item.id,
          version: item.version,
          item,
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
      <Modal title={item.id ? t("lessonEdit") : t("lessonAdd")} onClose={close}>
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
                  onClick={() =>
                    change(
                      "weekdays",
                      item.weekdays.includes(d)
                        ? item.weekdays.filter((x: number) => x !== d)
                        : [...item.weekdays, d],
                    )
                  }
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
          <Field label={t("lessonTime")}>
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
              onChange={(e) => change("effective", e.target.value)}
            />
          </Field>
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
          <Btn onClick={close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function SessionModal({ modal, env, close }: any) {
    const lesson = lessonOf(env.data, modal.lessonId);
    const occ0 = modal.occurrence;
    const [mode] = useState(modal.mode);
    const [date, setDate] = useState(modal.date || occ0?.date || "");
    const [time, setTime] = useState(
      modal.time ?? occ0?.time ?? lesson?.time ?? "",
    );
    const [place, setPlace] = useState(
      modal.place ?? occ0?.place ?? lesson?.place ?? "",
    );
    const [note, setNote] = useState(occ0?.note || "");
    const [deduction, setDeduction] = useState(
      occ0?.deduction ?? lesson?.defaultDeduction ?? 1,
    );
    const [confirmShort, setShort] = useState(false),
      [confirmConflict, setConflict] = useState(false);
    const [error, setError] = useState("");
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
          await env.act({
            ...common,
            command: "complete",
            date,
            deduction,
            note,
            confirmShort,
          });
        else if (mode === "move")
          await env.act({
            ...common,
            command: "save",
            date,
            time,
            place,
            note,
            confirmConflict,
          });
        else if (mode === "extra")
          await env.act({
            ...common,
            command: "add",
            date,
            time,
            place,
            note,
            confirmConflict,
          });
        else if (mode === "skip")
          await env.act({ ...common, command: "skip", note });
        else if (mode === "undo") await env.act({ ...common, command: "undo" });
        else if (mode === "restore")
          await env.act({ ...common, command: "restore" });
        else if (mode === "unskip")
          await env.act({
            ...common,
            command: "save",
            date: modal.originalDate || occ0?.date,
            time: lesson.time,
            place: lesson.place,
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
          onClose={close}
        >
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
            <Btn onClick={close}>{t("cancel")}</Btn>
          </div>
        </Modal>
      );
    return (
      <Modal
        title={lesson.title + " · " + (occ0?.date || date)}
        onClose={close}
      >
        <p className="ld-help">
          {t(
            mode === "complete"
              ? "lessonCompleteHint"
              : mode === "skip"
                ? "lessonSkipHint"
                : mode === "extra"
                  ? t("lessonExtraHint")
                  : t("lessonRescheduleHint"),
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
                  ? t("lessonSkip")
                  : t("save"),
            )}
          </Btn>
          <Btn onClick={close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function ChargeModal({ modal, env, close }: any) {
    const lesson = lessonOf(env.data, modal.lessonId);
    const [kind, setKind] = useState(modal.kind || "purchase");
    const [date, setDate] = useState(env.day);
    const [delta, setDelta] = useState<any>("");
    const [amount, setAmount] = useState<any>("");
    const [expiresOn, setExpiry] = useState("");
    const [note, setNote] = useState("");
    const [error, setError] = useState("");
    if (!lesson) return null;
    const save = async () => {
      try {
        setError("");
        const n = Number(delta);
        if (!n) return setError(t("lessonChargeDeltaRequired"));
        await env.act({
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
        onClose={close}
      >
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
          <Btn onClick={close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function TermModal({ modal, env, close }: any) {
    const lesson = lessonOf(env.data, modal.lessonId);
    const terms = lesson ? lessonTerms(env.data, lesson.id) : [];
    const last = terms.at(-1);
    const editing = modal.term;
    const [start, setStart] = useState(
      editing?.start || (last ? shift(last.end, 1) : env.day),
    );
    const [end, setEnd] = useState(editing?.end || "");
    const [purchased, setPurchased] = useState(
      editing?.purchased ?? last?.purchased ?? 0,
    );
    const [amount, setAmount] = useState<any>(
      editing?.amount ?? last?.amount ?? "",
    );
    const [note, setNote] = useState(editing?.note || "");
    const [error, setError] = useState("");
    if (!lesson) return null;
    const save = async () => {
      try {
        setError("");
        if (!end) return setError(t("lessonTermRequired"));
        await env.act({
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
      <Modal title={t("lessonRenew") + " · " + lesson.title} onClose={close}>
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
          <Btn onClick={close}>{t("cancel")}</Btn>
        </div>
      </Modal>
    );
  }
  function LessonDetail({ modal, env, close }: any) {
    const lesson = lessonOf(env.data, modal.lessonId);
    const [error, setError] = useState("");
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
    return (
      <Modal title={lesson.title} onClose={close}>
        <p className="ld-help">
          {lesson.participant || t("lessonNoParticipant")}
          {lesson.place ? " · " + lesson.place : ""}
        </p>
        <div className="ld-lesson-summary">
          <span>{modeText(lesson.mode)}</span>
          <span>
            {lessonScheduleLabel(lesson, t)} · {lessonTimeLabel(lesson)}
          </span>
          <span>{lessonTimeLabel(lesson) ? "" : "全天"}</span>
        </div>
        {lesson.mode === "credit" && account && (
          <div className="ld-lesson-money">
            <strong>{account.balance}</strong> {t("lessonUnit")}
            <small>
              {t("lessonPurchased")} {account.purchased} · {t("lessonGifted")}{" "}
              {account.gifted} · {t("lessonUsed")} {account.used}
            </small>
          </div>
        )}
        {lesson.mode === "term" && (
          <div className="ld-lesson-money">
            {summary.currentTerm ? (
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
              open({ type: "session", mode: "complete", lessonId: lesson.id })
            }
          >
            {t("lessonComplete")}
          </Btn>
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
            next.map((x: any) => (
              <div className="ld-lesson-row" key={x.key}>
                <span>
                  {x.date} {x.time}
                </span>
                <span>
                  {statusText(x.status)}
                  {x.movedFrom
                    ? " · " + t("lessonMovedFrom") + " " + x.movedFrom
                    : ""}
                </span>
                <div className="ld-actions">
                  {(x.status === "scheduled" || x.status === "skipped") && (
                    <Btn
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
                  {x.status === "skipped" && (
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
                    <Btn onClick={() => removeExtra(x.sessionId)}>
                      {t("delete")}
                    </Btn>
                  )}
                  {x.status === "done" && (
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
              </div>
            ))
          ) : (
            <p className="ld-help">{t("lessonNoUpcoming")}</p>
          )}
        </section>
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
  function LessonHub({ modal, env, close }: any) {
    if (!modal) return null;
    if (modal.type === "editor")
      return <LessonEditor modal={modal} env={env} close={close} />;
    if (modal.type === "session")
      return <SessionModal modal={modal} env={env} close={close} />;
    if (modal.type === "charge")
      return <ChargeModal modal={modal} env={env} close={close} />;
    if (modal.type === "term")
      return <TermModal modal={modal} env={env} close={close} />;
    if (modal.type === "detail")
      return <LessonDetail modal={modal} env={env} close={close} />;
    return null;
  }
  function TodayLessons({ env }: any) {
    const data = env.data,
      day = env.day;
    const lessons = live(data, "lessons");
    const rows = lessons.flatMap((l: any) =>
      lessonOccurrences(data, l, day, day),
    );
    const open = (v: any) =>
      env.openLesson({ ...v, lessonId: v.lessonId || l0(v) });
    const l0 = (v: any) => v.lessonId;
    return (
      <section className="ld-section ld-today-lessons">
        <div className="ld-section-heading">
          <h2>{t("todayLessons")}</h2>
          <span className="ld-fold-count">{rows.length}</span>
        </div>
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
                  {x.status === "scheduled" && (
                    <Btn
                      disabled={env.busy}
                      onClick={() =>
                        env.openLesson({
                          type: "session",
                          mode: "complete",
                          lessonId: x.lessonId,
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
      </section>
    );
  }
  function LessonsPage({ env }: any) {
    const data = env.data;
    const lessons = live(data, "lessons");
    const [person, setPerson] = useState("");
    const people = [
      ...new Set(lessons.map((x: any) => x.participant).filter(Boolean)),
    ];
    const filtered = person
      ? lessons.filter((x: any) => x.participant === person)
      : lessons;
    const open = (v: any) => env.openLesson(v);
    const dayRows = filtered.flatMap((l: any) =>
      lessonOccurrences(data, l, env.day, env.day),
    );
    const start = monday(env.day),
      dates = Array.from({ length: 7 }, (_, i) => shift(start, i));
    const weekRows = filtered.flatMap((l: any) =>
      lessonOccurrences(data, l, start, shift(start, 6)),
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
        {(() => {
          const warnings = lessonExpiring(data, env.day);
          const low = lessons
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
        <section className="ld-section">
          <div className="ld-section-heading">
            <h2>{t("lessonDay")}</h2>
            <span className="ld-fold-count">{dayRows.length}</span>
          </div>
          {dayRows.length ? (
            dayRows
              .sort((a: any, b: any) =>
                (a.time || "99:99").localeCompare(b.time || "99:99"),
              )
              .map((x: any) => (
                <div
                  className={
                    "ld-lesson-today " + (x.status === "done" ? "is-done" : "")
                  }
                  key={x.key}
                >
                  <button
                    className="ld-task-body"
                    onClick={() =>
                      open({ type: "detail", lessonId: x.lessonId })
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
                      {x.place ? " · " + x.place : ""}
                      {x.movedFrom
                        ? " · " + t("lessonMovedFrom") + " " + x.movedFrom
                        : ""}
                    </span>
                  </button>
                  {x.status === "scheduled" && (
                    <Btn
                      onClick={() =>
                        open({
                          type: "session",
                          mode: "complete",
                          lessonId: x.lessonId,
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
                </div>
              ))
          ) : (
            <p className="ld-help">{t("lessonDayEmpty")}</p>
          )}
        </section>
        <section className="ld-section">
          <div className="ld-section-heading">
            <h2>{t("lessonWeek")}</h2>
            <span className="ld-help">
              {start} – {shift(start, 6)}
            </span>
          </div>
          <div className="ld-week-grid">
            {dates.map((d: any) => (
              <div className="ld-week-cell" key={d}>
                <h3>
                  {t("weekdayShort" + weekday(d))} <small>{d.slice(5)}</small>
                </h3>
                {weekRows
                  .filter((x: any) => x.date === d)
                  .sort((a: any, b: any) =>
                    (a.time || "99:99").localeCompare(b.time || "99:99"),
                  )
                  .map((x: any) => (
                    <button
                      key={x.key}
                      className={
                        "ld-week-lesson " +
                        (x.status === "done" ? "is-done" : "")
                      }
                      onClick={() =>
                        open({ type: "detail", lessonId: x.lessonId })
                      }
                    >
                      <span>{x.time}</span>
                      <strong>{x.title}</strong>
                      <small>
                        {x.participant || ""}
                        {x.status === "skipped"
                          ? " · " + t("lessonStatusSkipped")
                          : ""}
                      </small>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </section>
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
                        {lessonScheduleLabel(l, t)}
                        {l.time ? " · " + lessonTimeLabel(l) : ""}
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
                        onClick={() => open({ type: "detail", lessonId: l.id })}
                      >
                        {t("lessonDetail")}
                      </Btn>
                      <Btn onClick={() => open({ type: "editor", lesson: l })}>
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
      </div>
    );
  }
  return { LessonHub, LessonsPage, TodayLessons };
}
