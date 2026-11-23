import * as React from "react";
import {
  lifeView,
  lifePeriodRows,
  projectOverview,
  workspacePeriod,
  shiftWorkspacePeriod,
} from "./workspace-views.js";
import { weekday } from "./dates.js";
export function WorkspacePeriodGrid({
  dates,
  day,
  rows,
  renderItem,
  t,
  month = false,
}: any) {
  return (
    <div
      className="ld-workspace-period-scroll"
      tabIndex={0}
      aria-label={t("workspacePeriodLabel")}
    >
      <div className={"ld-workspace-period-grid" + (month ? " is-month" : "")}>
        {month &&
          [1, 2, 3, 4, 5, 6, 0].map((d) => (
            <div className="ld-workspace-weekday" key={d}>
              {t("weekdayShort" + d)}
            </div>
          ))}
        {dates.map((d: string) => (
          <section
            className={
              "ld-workspace-date-cell" +
              (month && d.slice(0, 7) !== day.slice(0, 7)
                ? " is-outside"
                : "") +
              (d === day ? " is-selected" : "")
            }
            key={d}
            aria-label={d}
          >
            <h3>
              {month
                ? Number(d.slice(8))
                : t("weekdayShort" + weekday(d)) + " " + d.slice(5)}
            </h3>
            <div className="ld-workspace-date-items">
              {rows.filter((x: any) => x.date === d).map(renderItem)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
export function WorkspacePeriodNav({ env, view, t, Btn }: any) {
  const p = workspacePeriod(env.day, view);
  return (
    <div className="ld-actions ld-workspace-period-nav">
      <Btn
        aria-label={t("habitPeriodPrev")}
        onClick={() => env.setDay(shiftWorkspacePeriod(env.day, view, -1))}
      >
        ‹
      </Btn>
      <span>
        {view === "month" ? env.day.slice(0, 7) : p.from + " — " + p.to}
      </span>
      <Btn
        aria-label={t("habitPeriodNext")}
        onClick={() => env.setDay(shiftWorkspacePeriod(env.day, view, 1))}
      >
        ›
      </Btn>
    </div>
  );
}
export function createWorkspaceViews({ t, Btn }: any) {
  function LifeViews({ env, category, taskRows }: any) {
    const [view, setView] = React.useState("day");
    const groups = lifeView(env.data, env.day, category);
    const period = workspacePeriod(env.day, view);
    const periodRows =
      view === "week" || view === "month"
        ? lifePeriodRows(groups.state, period.from, period.to)
        : [];
    const open = (x: any) =>
      env.openTask(
        env.tasks.find((q: any) => q.id === x.id),
        x.originalDate ? { occurrence: x } : {},
      );
    const section = (key: string, items: any[], empty?: string) => (
      <section className="ld-section">
        <h3>
          {t(key)} · {items.length}
        </h3>
        {items.length ? (
          taskRows(items, false)
        ) : empty ? (
          <p className="ld-help">{t(empty)}</p>
        ) : null}
      </section>
    );
    const deadlines = (
      <section className="ld-section">
        <h3>
          {t("deadlineWatch")} · {groups.due.length}
        </h3>
        {groups.due.map((x: any) => (
          <button className="ld-time-index" key={x.id} onClick={() => open(x)}>
            <span>{x.deadline}</span>
            <span>{x.title}</span>
            <small>
              {t("originalDate")} {x.date || "—"}
            </small>
          </button>
        ))}
      </section>
    );
    return (
      <div className="ld-life-views">
        <div className="ld-toolbar">
          <div
            className="ld-actions"
            role="group"
            aria-label={t("workspaceViews")}
          >
            {["day", "week", "month", "all"].map((v) => (
              <Btn key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {t(v === "all" ? "workspaceAllItems" : v + "View")}
              </Btn>
            ))}
          </div>
          {["week", "month"].includes(view) && (
            <WorkspacePeriodNav env={env} view={view} t={t} Btn={Btn} />
          )}
        </div>
        {view === "day" && (
          <>
            <p className="ld-help">
              {t("workspaceDayCount")
                .replace("{done}", String(groups.completed.length))
                .replace(
                  "{total}",
                  String(groups.pending.length + groups.completed.length),
                )}
            </p>
            {section("workspacePending", groups.pending, "lifeDayEmpty")}
            <div className="ld-workspace-completed">
              {section("completed", groups.completed)}
            </div>
            {!!groups.reminders.length &&
              section("workspaceReminders", groups.reminders)}
            {!!groups.carried.length &&
              section("workspaceCarried", groups.carried)}
            {!!groups.previousRecurring.length && (
              <details className="ld-details">
                <summary>
                  {t("workspacePastRecurring")} ·{" "}
                  {groups.previousRecurring.length}
                </summary>
                {taskRows(groups.previousRecurring, false)}
              </details>
            )}
            {!!groups.due.length && deadlines}
            {!!groups.unscheduled.length && (
              <details className="ld-details">
                <summary>
                  {t("workspaceUnscheduled")} · {groups.unscheduled.length}
                </summary>
                {taskRows(groups.unscheduled, false)}
              </details>
            )}
          </>
        )}
        {["week", "month"].includes(view) && (
          <>
            <WorkspacePeriodGrid
              dates={view === "month" ? period.dates : period.dates}
              day={env.day}
              rows={periodRows}
              month={view === "month"}
              t={t}
              renderItem={(x: any) => (
                <button
                  type="button"
                  className={
                    "ld-workspace-period-item" +
                    (x.status === "done" ? " is-done" : "")
                  }
                  key={x.id + "@" + x.originalDate}
                  onClick={() => open(x)}
                >
                  <span>{x.time || ""}</span>
                  <strong>
                    {x.status === "done" ? "✓ " : ""}
                    {x.title}
                  </strong>
                  {x.event && <small>{t("workspaceReminder")}</small>}
                </button>
              )}
            />
            <p className="ld-help">{t("workspaceScheduleOnly")}</p>
          </>
        )}
        {view === "all" && (
          <>
            <p className="ld-help">{t("workspaceAllSeriesHint")}</p>
            {taskRows(groups.all)}
          </>
        )}
      </div>
    );
  }
  function ProjectsView({
    env,
    project,
    setProject,
    taskRows,
    editProject,
    createProject,
    board,
    setBoard,
  }: any) {
    const [filter, setFilter] = React.useState("active");
    const projects = env.projects;
    const p = projects.find((x: any) => x.id === project);
    const save = (p: any, item: any) =>
      env.run({
        action: "save",
        collection: "projects",
        id: p.id,
        version: p.version,
        item,
      });
    if (!p) {
      const list = projects.filter((p: any) =>
        filter === "archived"
          ? p.archived
          : filter === "done"
            ? !p.archived && p.status === "done"
            : !p.archived && p.status !== "done",
      );
      return (
        <>
          <div className="ld-toolbar">
            <Btn primary icon="plus" onClick={createProject}>
              {t("addProject")}
            </Btn>
            <div className="ld-actions">
              {["active", "done", "archived"].map((v) => (
                <Btn
                  key={v}
                  aria-pressed={filter === v}
                  onClick={() => setFilter(v)}
                >
                  {t("projectFilter_" + v)}
                </Btn>
              ))}
            </div>
          </div>
          {list.length ? (
            list.map((p: any) => {
              const s = projectOverview(env.data, p, env.day);
              return (
                <button
                  key={p.id}
                  className="ld-project-row ld-project-overview"
                  onClick={() => setProject(p.id)}
                >
                  <span>
                    <strong>{p.title}</strong>
                    <small>
                      {t(p.status)} · {s.completed.length}/{s.tasks.length}
                      {p.deadline
                        ? " · " + t("deadline") + " " + p.deadline
                        : ""}
                      {p.group ? " · " + p.group : ""}
                    </small>
                    {p.goal && <small>{p.goal}</small>}
                    <small className="ld-project-next-label">
                      {s.next
                        ? t("projectNext") +
                          "：" +
                          s.next.title +
                          (s.next.date ? " · " + s.next.date : "")
                        : t(s.allDone ? "projectReady" : "projectNoNext")}
                    </small>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="ld-help">{t("empty")}</p>
          )}
        </>
      );
    }
    const s = projectOverview(env.data, p, env.day);
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
            <Btn onClick={() => editProject(p)}>{t("edit")}</Btn>
            <Btn
              disabled={env.busy}
              onClick={() => save(p, { archived: !p.archived })}
            >
              {t(p.archived ? "projectUnarchive" : "projectArchive")}
            </Btn>
          </div>
        </div>
        <section className="ld-section">
          <h3>{t("goal")}</h3>
          <p className="ld-project-goal">{p.goal || t("projectGoalEmpty")}</p>
          <p className="ld-help">
            {t(p.status)} · {s.completed.length}/{s.tasks.length}
            {p.deadline ? " · " + t("deadline") + " " + p.deadline : ""}
            {p.archived ? " · " + t("projectFilter_archived") : ""}
          </p>
        </section>
        {s.allDone && p.status !== "done" && (
          <div className="ld-project-ready">
            <p>{t("projectCompletePrompt")}</p>
            <Btn
              primary
              disabled={env.busy}
              onClick={() => save(p, { status: "done" })}
            >
              {t("projectCompleteConfirm")}
            </Btn>
          </div>
        )}
        {p.status === "done" && (
          <Btn disabled={env.busy} onClick={() => save(p, { status: "doing" })}>
            {t("projectReopen")}
          </Btn>
        )}
        <section className="ld-section">
          <h3>{t("projectNext")}</h3>
          {s.next ? (
            <button
              className="ld-project-next-task"
              onClick={() =>
                env.openTask(
                  env.tasks.find((x: any) => x.id === s.next.id),
                  s.next.originalDate ? { occurrence: s.next } : {},
                )
              }
            >
              {s.next.title}
              {s.next.date ? " · " + s.next.date : ""}{" "}
              <small>
                {t(s.explicit ? "projectNextChosen" : "projectNextSuggested")}
              </small>
            </button>
          ) : (
            <p className="ld-help">{t("projectNoNext")}</p>
          )}
          {s.pending.length > 0 && (
            <label className="ld-project-next-select">
              {t("projectChooseNext")}{" "}
              <select
                disabled={env.busy}
                value={s.explicit ? p.nextTaskId : ""}
                onChange={(e) => save(p, { nextTaskId: e.target.value })}
              >
                <option value="">{t("projectNextAuto")}</option>
                {s.pending.map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="ld-help">{t("projectDateHint")}</p>
        </section>
        <Btn primary icon="plus" onClick={() => env.openTask()}>
          {t("addTask")}
        </Btn>
        {board ? (
          <div className="ld-board">
            {["todo", "doing", "done"].map((status) => (
              <section key={status}>
                <h3>
                  {t(status)} ·{" "}
                  {s.tasks.filter((x: any) => x.status === status).length}
                </h3>
                {taskRows(s.tasks.filter((x: any) => x.status === status))}
              </section>
            ))}
          </div>
        ) : (
          <>
            <section className="ld-section">
              <h3>
                {t("workspacePending")} · {s.pending.length}
              </h3>
              {taskRows(s.pending)}
            </section>
            <details className="ld-details">
              <summary>
                {t("completed")} · {s.completed.length}
              </summary>
              {taskRows(s.completed, false)}
            </details>
          </>
        )}
        {!!s.settled.length && (
          <details className="ld-details">
            <summary>
              {t("workspaceOtherStates")} · {s.settled.length}
            </summary>
            {taskRows(s.settled, false)}
          </details>
        )}
      </>
    );
  }
  return { LifeViews, ProjectsView };
}
