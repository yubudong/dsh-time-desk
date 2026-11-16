import * as React from "react";
const { useState, useRef, useEffect } = React;
export function createPlanningUI({ t, Btn, Field }: any) {
  function TaskFields({ draft, setDraft, projects }: any) {
    const change = (key: string, value: any) =>
      setDraft({ ...draft, [key]: value });
    return (
      <div className="ld-form ld-capture-fields">
        <Field label={t("projects")}>
          <select
            value={draft.projectId}
            onChange={(e) => change("projectId", e.target.value)}
          >
            <option value="">{t("noProject")}</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("area")}>
          <select
            value={draft.area}
            onChange={(e) => change("area", e.target.value)}
          >
            {["inbox", "work", "life"].map((x) => (
              <option key={x} value={x}>
                {t(
                  x === "inbox"
                    ? "inboxArea"
                    : x === "life"
                      ? "lifeArea"
                      : "work",
                )}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("planStart")}>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => change("date", e.target.value)}
          />
        </Field>
        <Field label={t("deadline")}>
          <input
            type="date"
            value={draft.deadline}
            onChange={(e) => change("deadline", e.target.value)}
          />
        </Field>
        <Field label={t("estimateMinutes")}>
          <input
            type="number"
            min={0}
            max={1440}
            value={draft.minutes}
            onChange={(e) => change("minutes", Number(e.target.value))}
          />
        </Field>
        <Field label={t("estimatePomodoros")}>
          <input
            type="number"
            min={0}
            max={100}
            value={draft.pomodoros}
            onChange={(e) => change("pomodoros", Number(e.target.value))}
          />
        </Field>
      </div>
    );
  }
  function QuickCapture({
    open,
    onClose,
    projects,
    act,
    busy,
    onSaved,
    onDirty,
    onDetails,
    resetToken,
  }: {
    open: boolean;
    onClose: () => void;
    projects: any[];
    act: (action: any) => Promise<any>;
    busy: boolean;
    onSaved: () => void;
    onDirty: (dirty: boolean) => void;
    onDetails: (draft: any, requestId: string) => void;
    resetToken: number;
  }) {
    const empty = () => ({
      title: "",
      area: "inbox",
      projectId: "",
      date: "",
      deadline: "",
      minutes: 0,
      pomodoros: 0,
    });
    const [draft, setDraftState] = useState(empty),
      [error, setError] = useState("");
    const input = useRef<HTMLInputElement>(null),
      locked = useRef(false),
      requestId = useRef(crypto.randomUUID());
    const setDraft = (next: any) => {
      requestId.current = crypto.randomUUID();
      setDraftState(next);
    };
    useEffect(() => {
      if (open && !busy) input.current?.focus();
    }, [open, busy]);
    useEffect(() => {
      onDirty(
        !!(
          draft.title.trim() ||
          draft.projectId ||
          draft.date ||
          draft.deadline ||
          draft.minutes ||
          draft.pomodoros ||
          draft.area !== "inbox"
        ),
      );
    }, [draft]);
    useEffect(() => () => onDirty(false), []);
    useEffect(() => {
      setDraft(empty());
      setError("");
    }, [resetToken]);
    if (!open) return null;
    async function save(e: any) {
      e.preventDefault();
      if (locked.current || busy || !draft.title.trim()) return;
      locked.current = true;
      setError("");
      try {
        await act({
          action: "save",
          collection: "tasks",
          requestId: requestId.current,
          item: { ...draft, area: draft.projectId ? "work" : draft.area },
        });
        setDraft(empty());
        onSaved();
        input.current?.focus();
      } catch (e: any) {
        setError(e.message);
      } finally {
        locked.current = false;
      }
    }
    return (
      <section
        id="ld-quick-capture"
        className="ld-quick-panel"
        aria-label={t("quickCapture")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <div className="ld-capture-title">
              <input
                ref={input}
                aria-label={t("taskTitle")}
                placeholder={t("quickPlaceholder")}
                maxLength={200}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <Btn type="submit" primary disabled={busy || !draft.title.trim()}>
                {t("captureSave")}
              </Btn>
              <Btn type="button" onClick={onClose}>
                {t("close")}
              </Btn>
            </div>
            <details>
              <summary>{t("captureOptions")}</summary>
              <TaskFields
                draft={draft}
                setDraft={setDraft}
                projects={projects}
              />
            </details>
            <Btn
              type="button"
              onClick={() =>
                onDetails(
                  { ...draft, area: draft.projectId ? "work" : draft.area },
                  requestId.current,
                )
              }
            >
              {t("captureDetails")}
            </Btn>
          </fieldset>
          <p className="ld-help">{t("captureHint")}</p>
          {error && (
            <p role="alert" className="ld-error">
              {error}
            </p>
          )}
        </form>
      </section>
    );
  }
  function PlanPanel({ plan, date, act, busy }: any) {
    const capacity = plan.load.availableMinutes;
    const [value, setValue] = useState(
        capacity === null ? "" : String(capacity),
      ),
      [error, setError] = useState("");
    useEffect(() => {
      setValue(capacity === null ? "" : String(capacity));
      setError("");
    }, [date, capacity]);
    async function save(e: any) {
      e.preventDefault();
      setError("");
      try {
        await act({
          action: "plan",
          command: "capacity",
          date,
          item: { availableMinutes: value === "" ? null : Number(value) },
        });
      } catch (e: any) {
        setError(e.message);
      }
    }
    const load = plan.load;
    return (
      <section className="ld-plan-panel" aria-label={t("dailyPlan")}>
        <div className="ld-plan-heading">
          <h2>{t("dailyPlan")}</h2>
          <span>{date}</span>
        </div>
        <div className="ld-plan-stats">
          <div>
            <strong>{load.knownMinutes}</strong>
            <span>{t("estimatedMin")}</span>
          </div>
          <div>
            <strong>{load.unknownCount}</strong>
            <span>{t("unestimatedTasks")}</span>
          </div>
          <div>
            <strong>{load.recordedFocusMinutes}</strong>
            <span>{t("recordedFocus")}</span>
          </div>
        </div>
        <form className="ld-plan-capacity" onSubmit={save}>
          <label>
            {t("availableToday")}
            <input
              type="number"
              min={0}
              max={1440}
              step={1}
              value={value}
              placeholder={t("notSet")}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <Btn type="submit" disabled={busy}>
            {t("save")}
          </Btn>
        </form>
        <p
          className={"ld-help " + (load.overMinutes > 0 ? "ld-plan-over" : "")}
        >
          {capacity === null
            ? t("capacityHint")
            : load.overMinutes > 0
              ? t("overCapacity") + " " + load.overMinutes + " " + t("min")
              : t("withinCapacity")}
          {" · "}
          {t("estimateHint")}
        </p>
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }
  function InboxItem({ task, projects, act, busy, onEdit, day }: any) {
    const [editing, setEditing] = useState(false),
      [draft, setDraft] = useState<any>(null),
      [error, setError] = useState("");
    const version = useRef(task.version);
    const edit = () => {
      version.current = task.version;
      setDraft({ ...task, area: "work" });
      setEditing(true);
      setError("");
    };
    async function save(e: any) {
      e.preventDefault();
      setError("");
      try {
        await act({
          action: "save",
          collection: "tasks",
          id: task.id,
          version: version.current,
          item: {
            area: draft.projectId ? "work" : draft.area,
            projectId: draft.projectId,
            date: draft.date,
            deadline: draft.deadline,
            minutes: draft.minutes,
            pomodoros: draft.pomodoros,
          },
        });
        setEditing(false);
      } catch (e: any) {
        setError(e.message);
      }
    }
    return (
      <article className="ld-inbox-item">
        <div className="ld-inbox-heading">
          <button className="ld-task-body" onClick={() => onEdit(task)}>
            <span className="ld-task-title">{task.title}</span>
            <span className="ld-task-meta">
              {task.deadline
                ? t("deadline") + " " + task.deadline
                : t("awaitingTriage")}
            </span>
          </button>
          {!editing && (
            <Btn disabled={busy} onClick={edit}>
              {t("organize")}
            </Btn>
          )}
        </div>
        {editing && (
          <form onSubmit={save}>
            <TaskFields draft={draft} setDraft={setDraft} projects={projects} />
            <div className="ld-actions">
              <Btn
                type="button"
                onClick={() => setDraft({ ...draft, date: day })}
              >
                {t("planToday")}
              </Btn>
              <Btn type="submit" primary disabled={busy}>
                {t("save")}
              </Btn>
              <Btn type="button" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Btn>
            </div>
            <p className="ld-help">{t("triageHint")}</p>
          </form>
        )}
        {error && (
          <p className="ld-error" role="alert">
            {error}
          </p>
        )}
      </article>
    );
  }
  return { QuickCapture, PlanPanel, InboxItem };
}
