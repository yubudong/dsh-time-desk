import * as React from "react";
import {
  reviewPrompts,
  normalizeTemplate,
  hasReviewContent,
} from "./review-template.js";
import { today, shift, habitProgress, habitDue } from "./dates.js";
const { useState, useEffect, useRef, useId } = React;
export function createReviewUI({ t, Btn, Modal, act, send, drafts }: any) {
  const versions = new Map<string, number>();
  function TemplateModal({ data, busy, close }: any) {
    const [original, setOriginal] = useState(
      data.settings.reviewTemplate || "",
    );
    const [text, setText] = useState(original || t("defaultReviewTemplate"));
    const [useDefault, setDefault] = useState(!original);
    const [error, setError] = useState("");
    useEffect(() => {
      if ((useDefault ? "" : text) !== original)
        drafts.set("template:editor", "unsaved");
      else drafts.delete("template:editor");
    }, [text, useDefault, original]);
    useEffect(
      () => () => {
        drafts.delete("template:editor");
      },
      [],
    );
    const closeSafely = () => {
      if ((useDefault ? "" : text) !== original && !window.confirm(t("dirty")))
        return;
      close();
    };
    const save = async () => {
      setError("");
      try {
        await act({
          action: "settings",
          command: "reviewTemplate",
          text: original,
          item: { reviewTemplate: useDefault ? "" : normalizeTemplate(text) },
        });
        close();
      } catch (e: any) {
        setError(e.message);
      }
    };
    return (
      <Modal title={t("reviewTemplateTitle")} onClose={closeSafely}>
        <p className="ld-help">{t("reviewTemplateHelp")}</p>
        <label className="ld-field">
          <span>{t("reviewTemplateQuestions")}</span>
          <textarea
            className="ld-review-text"
            rows={6}
            maxLength={2000}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setDefault(false);
            }}
          />
        </label>
        {(data.settings.reviewTemplate || "") !== original && (
          <div className="ld-review-conflict">
            <p className="ld-help">{t("reviewConflictHint")}</p>
            <pre>
              {data.settings.reviewTemplate || t("defaultReviewTemplate")}
            </pre>
            <Btn
              disabled={busy}
              onClick={() => {
                setOriginal(data.settings.reviewTemplate || "");
                setError("");
              }}
            >
              {t("reviewTemplateKeep")}
            </Btn>
          </div>
        )}
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        <div className="ld-actions">
          <Btn primary disabled={busy} onClick={save}>
            {t("saveTemplate")}
          </Btn>
          <Btn
            disabled={busy}
            onClick={() => {
              setText(t("defaultReviewTemplate"));
              setDefault(true);
            }}
          >
            {t("restoreDefaultTemplate")}
          </Btn>
          <Btn disabled={busy} onClick={closeSafely}>
            {t("cancel")}
          </Btn>
        </div>
      </Modal>
    );
  }
  function ReviewEditor({
    data,
    date,
    kind = "day",
    habitId,
    busy,
    onSaved,
    onOpenSpirit,
  }: {
    data: any;
    date: string;
    kind?: string;
    habitId?: string;
    busy: boolean;
    onSaved?: (result: any) => void;
    onOpenSpirit: (context: any) => void;
  }) {
    const key = kind + ":" + date;
    const record = data.reviews.find(
      (r: any) => !r.deletedAt && r.date === date && r.kind === kind,
    );
    const initialVersion = versions.get(key) ?? record?.version ?? 0;
    const [text, setText] = useState(drafts.get(key) ?? record?.text ?? "");
    const [baseVersion, setBaseVersion] = useState(initialVersion);
    const requestId = useRef(crypto.randomUUID());
    const [error, setError] = useState(""),
      [saved, setSaved] = useState(false),
      [showPrompts, setPrompts] = useState(true),
      [templateOpen, setTemplateOpen] = useState(false);
    const textareaId = useId();
    useEffect(() => {
      if (!drafts.has(key)) {
        setText(record?.text || "");
        setBaseVersion(record?.version || 0);
      }
    }, [record?.version]);
    const change = (value: string) => {
      setText(value);
      setSaved(false);
      requestId.current = crypto.randomUUID();
      if (value === (record?.text || "")) {
        drafts.delete(key);
        versions.delete(key);
        setBaseVersion(record?.version || 0);
      } else {
        drafts.set(key, value);
        versions.set(key, baseVersion);
      }
    };
    const save = async () => {
      setError("");
      try {
        const result = await act({
          action: "review",
          date,
          kind,
          text,
          id: habitId,
          version: baseVersion,
          requestId: requestId.current,
        });
        drafts.delete(key);
        versions.delete(key);
        const stored = result.reviews?.find(
          (r: any) => !r.deletedAt && r.date === date && r.kind === kind,
        );
        setBaseVersion(stored?.version || baseVersion + 1);
        setSaved(true);
        onSaved?.(result);
      } catch (e: any) {
        setError(e.message);
      }
    };
    const valid = hasReviewContent(
      text,
      data.settings.reviewTemplate,
      t("defaultReviewTemplate"),
    );
    return (
      <div className="ld-review-editor">
        {kind === "day" && (
          <>
            <div className="ld-actions ld-review-options">
              <Btn disabled={busy} onClick={() => setPrompts(!showPrompts)}>
                {t(showPrompts ? "reviewFreeWrite" : "reviewShowPrompts")}
              </Btn>
              <Btn disabled={busy} onClick={() => setTemplateOpen(true)}>
                {t("reviewTemplateButton")}
              </Btn>
            </div>
            {showPrompts && (
              <>
                <p className="ld-help">{t("reviewPromptsHint")}</p>
                <ul className="ld-review-prompts">
                  {reviewPrompts(
                    data.settings.reviewTemplate,
                    t("defaultReviewTemplate"),
                  ).map((p: string) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <label className="ld-field" htmlFor={textareaId}>
          <span>
            {date} · {t("reviewContent")}
          </span>
          <textarea
            id={textareaId}
            className="ld-review-text"
            rows={7}
            value={text}
            onChange={(e) => change(e.target.value)}
            maxLength={20000}
            disabled={busy}
          />
        </label>
        {(record?.version || 0) !== baseVersion && (
          <div className="ld-review-conflict">
            <p className="ld-help">{t("reviewConflictHint")}</p>
            <pre>{record?.text || ""}</pre>
            <div className="ld-actions">
              <Btn
                disabled={busy}
                onClick={() => {
                  setBaseVersion(record?.version || 0);
                  versions.set(key, record?.version || 0);
                  requestId.current = crypto.randomUUID();
                  setError("");
                }}
              >
                {t("reviewKeepDraft")}
              </Btn>
              <Btn
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("dirty"))) return;
                  setText(record?.text || "");
                  setBaseVersion(record?.version || 0);
                  drafts.delete(key);
                  versions.delete(key);
                  setError("");
                }}
              >
                {t("reviewLoadLatest")}
              </Btn>
            </div>
          </div>
        )}
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="ld-update-ok" role="status">
            {t("reviewSavedFor")} · {date}
          </p>
        )}
        <div className="ld-actions">
          <Btn
            primary
            disabled={busy || !valid || date > today(data.settings.timeZone)}
            onClick={save}
          >
            {t(habitId ? "saveReviewComplete" : "save")}
          </Btn>
          {kind === "day" && (
            <Btn
              disabled={busy}
              onClick={() =>
                onOpenSpirit({
                  date,
                  text,
                  version: baseVersion,
                  habitId,
                  template:
                    data.settings.reviewTemplate || t("defaultReviewTemplate"),
                })
              }
            >
              {t("reviewAI")}
            </Btn>
          )}
        </div>
        {!valid && !!text.trim() && (
          <p className="ld-help">{t("reviewEmpty")}</p>
        )}
        {templateOpen && (
          <TemplateModal
            data={data}
            busy={busy}
            close={() => setTemplateOpen(false)}
          />
        )}
      </div>
    );
  }
  function ReviewCheckIn({
    habit,
    base,
    data,
    busy,
    close,
    onOpenSpirit,
  }: {
    habit: any;
    base: string;
    data: any;
    busy: boolean;
    close: () => void;
    onOpenSpirit: (context: any) => void;
  }) {
    const [date, setDate] = useState(base);
    const current = today(data.settings.timeZone),
      yesterday = shift(current, -1);
    const currentHabit =
      data.habits.find((h: any) => h.id === habit.id && !h.deletedAt) || habit;
    const progress = habitProgress(data, currentHabit, date);
    const [error, setError] = useState("");
    const flag = async (status: string) => {
      try {
        setError("");
        await act({
          action: "habitLog",
          id: habit.id,
          date,
          status,
          ...(status === "missed" ? {} : { skipped: true }),
        });
      } catch (e: any) {
        setError(e.message);
      }
    };
    const undoFlags = async () => {
      try {
        setError("");
        for (const log of data.habitLogs.filter(
          (l: any) =>
            !l.deletedAt &&
            l.habitId === habit.id &&
            l.date === date &&
            l.skipped,
        ))
          await act({
            action: "habitLog",
            id: habit.id,
            date,
            removeId: log.id,
          });
      } catch (e: any) {
        setError(e.message);
      }
    };

    return (
      <Modal title={habit.title + " · " + date} onClose={close}>
        <div className="ld-actions ld-review-date">
          <Btn
            disabled={busy || !habitDue(currentHabit, yesterday)}
            aria-pressed={date === yesterday}
            onClick={() => setDate(yesterday)}
          >
            {t("reviewYesterday")} · {yesterday}
          </Btn>
          <Btn
            disabled={busy || !habitDue(currentHabit, current)}
            aria-pressed={date === current}
            onClick={() => setDate(current)}
          >
            {t("reviewToday")} · {current}
          </Btn>
          {![current, yesterday].includes(base) && (
            <Btn
              disabled={busy}
              aria-pressed={date === base}
              onClick={() => setDate(base)}
            >
              {base}
            </Btn>
          )}
        </div>
        <p className="ld-help">{t("reviewDraftRetention")}</p>
        {(progress.skipped || progress.missed) && (
          <p className="ld-help">
            {t("reviewClearFlagHint")}{" "}
            <Btn disabled={busy} onClick={undoFlags}>
              {t("undo")}
            </Btn>
          </p>
        )}
        {progress.done && (
          <p className="ld-help">
            {t(progress.status === "late" ? "habitLate" : "habitOnTime")} ·{" "}
            {date} · {t("completedAt")}{" "}
            {new Date(progress.completedAt!).toLocaleString(undefined, {
              timeZone: data.settings.timeZone,
            })}
          </p>
        )}

        <ReviewEditor
          key={date}
          data={data}
          date={date}
          habitId={habit.id}
          busy={busy}
          onSaved={close}
          onOpenSpirit={(context: any) => {
            onOpenSpirit(context);
            close();
          }}
        />
        <details className="ld-details">
          <summary>{t("reviewOtherActions")}</summary>
          <div className="ld-actions">
            <Btn
              disabled={busy || progress.done || date > current}
              onClick={() => flag("skip")}
            >
              {t("reviewSkipDate")}
            </Btn>
            <Btn
              disabled={busy || progress.done || date > current}
              onClick={() => flag("missed")}
            >
              {t("reviewMissDate")}
            </Btn>
          </div>
        </details>
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
      </Modal>
    );
  }
  return { ReviewEditor, ReviewCheckIn };
}
