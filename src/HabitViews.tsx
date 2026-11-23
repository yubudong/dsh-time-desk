import * as React from "react";
import {
  habitCell,
  habitDayGroups,
  habitPeriod,
  shiftHabitPeriod,
} from "./habit-history.js";
import { today, weekday } from "./dates.js";
const marks: Record<string, string> = {
  done: "✓",
  late: "✓",
  partial: "◐",
  pending: "○",
  unrecorded: "○",
  future: "·",
  off: "—",
  rest: "—",
  optional: "·",
  missed: "×",
  skipped: "↷",
};
export function createHabitViews({ t, Btn }: any) {
  return function HabitViews({
    env,
    renderHabit,
    openLog,
    weeklyBlock,
    previousBlock,
    clock,
  }: any) {
    const { data, day, habits, busy, setDay, openHabit } = env;
    const [view, setView] = React.useState("day");
    const [selected, setSelected] = React.useState("");
    const chosen = habits.find((h: any) => h.id === selected) || habits[0];
    const groups = habitDayGroups(data, day, clock);
    const period = habitPeriod(day, view);
    const cellLabel = (cell: any) => t("habitCell_" + cell.status);
    const renderCell = (h: any, date: string, month = false) => {
      const c = habitCell(data, h, date, clock);
      const measured = ["quantity", "duration"].includes(c.rule?.mode);
      const detail =
        measured && (c.progress.value > 0 || c.expected)
          ? `${c.progress.value}/${c.progress.target} ${c.rule?.mode === "duration" ? t("min") : c.rule?.unit || ""}`
          : "";
      const label = [
        h.title,
        date,
        cellLabel(c),
        c.planned ? t("habitCell_planned") : "",
        detail,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <button
          type="button"
          key={date}
          className={`ld-habit-cell is-${c.status}${date === today(data.settings.timeZone, clock) ? " is-today" : ""}${month && date.slice(0, 7) !== day.slice(0, 7) ? " is-outside" : ""}`}
          disabled={busy || !c.viewable}
          title={label}
          aria-label={label}
          onClick={() => openLog(h, date)}
        >
          {month && (
            <span className="ld-habit-cell-date">{Number(date.slice(8))}</span>
          )}
          <span className="ld-habit-cell-mark" aria-hidden="true">
            {marks[c.status]}
          </span>
          {month && <small>{detail || cellLabel(c)}</small>}
        </button>
      );
    };
    const section = (title: string, items: any[], empty?: string) => (
      <section className="ld-habit-day-section">
        <h3>
          {title} · {items.length}
        </h3>
        {items.length ? (
          items.map(renderHabit)
        ) : empty ? (
          <p className="ld-help">{empty}</p>
        ) : null}
      </section>
    );
    return (
      <div className="ld-habit-views">
        <div className="ld-habit-view-toolbar">
          <div className="ld-actions" role="group" aria-label={t("habitViews")}>
            {["day", "week", "month"].map((v) => (
              <Btn key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {t(v + "View")}
              </Btn>
            ))}
          </div>
          {view === "day" ? (
            <strong>
              {t("habitDaySummary")
                .replace("{done}", String(groups.done.length))
                .replace("{total}", String(groups.total))}
            </strong>
          ) : (
            <div className="ld-actions">
              <Btn
                aria-label={t("habitPeriodPrev")}
                onClick={() => setDay(shiftHabitPeriod(day, view, -1))}
              >
                ‹
              </Btn>
              <span>
                {view === "month"
                  ? day.slice(0, 7)
                  : period.from + " — " + period.to}
              </span>
              <Btn
                aria-label={t("habitPeriodNext")}
                onClick={() => setDay(shiftHabitPeriod(day, view, 1))}
              >
                ›
              </Btn>
            </div>
          )}
        </div>
        {!habits.length && <p className="ld-help">{t("habitViewEmpty")}</p>}
        {view === "day" && habits.length > 0 && (
          <>
            {section(
              t("habitDayPending"),
              groups.pending,
              t("noPendingHabits"),
            )}
            <div className="ld-habits-completed">
              {section(t("doneHabits"), groups.done, t("habitNoneCompleted"))}
            </div>
            {!!groups.settled.length &&
              section(t("settledHabits"), groups.settled)}
            {previousBlock}
            {!!groups.weekly.length && (
              <section className="ld-habit-day-section">
                <h3>{t("weeklyHabits")}</h3>
                <p className="ld-help">{t("habitWeeklySeparate")}</p>
                {groups.weekly.map(renderHabit)}
                <details className="ld-details">
                  <summary>{t("habitWeeklyOptions")}</summary>
                  {weeklyBlock}
                </details>
              </section>
            )}
            {!!groups.other.length && (
              <details className="ld-details">
                <summary>
                  {t("habitOtherDays")} · {groups.other.length}
                </summary>
                {groups.other.map((h: any) => (
                  <div className="ld-habit-manage-row" key={h.id}>
                    <span>{h.title}</span>
                    <Btn onClick={() => openHabit(h)}>{t("edit")}</Btn>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        {view === "week" && habits.length > 0 && (
          <div className="ld-habit-table-scroll">
            <table className="ld-habit-week-table">
              <caption className="ld-visually-hidden">
                {t("habitWeekRecords")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("habits")}</th>
                  {period.dates.map((d: string) => (
                    <th key={d} scope="col">
                      {t("weekdayShort" + weekday(d))}
                      <small>{d.slice(5)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {habits.map((h: any) => (
                  <tr key={h.id}>
                    <th scope="row">
                      <button
                        className="ld-habit-name-button"
                        title={t("edit")}
                        onClick={() => openHabit(h)}
                      >
                        {h.title}
                      </button>
                    </th>
                    {period.dates.map((d: string) => (
                      <td key={d}>{renderCell(h, d)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === "month" && chosen && (
          <>
            <div className="ld-habit-month-toolbar">
              <label>
                {t("habitChoose")}{" "}
                <select
                  value={chosen.id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {habits.map((h: any) => (
                    <option key={h.id} value={h.id}>
                      {h.title}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                {t("habitMonthSummary").replace(
                  "{n}",
                  String(
                    period.dates.filter(
                      (d: string) =>
                        d >= period.from &&
                        d <= period.to &&
                        habitCell(data, chosen, d, clock).progress.done,
                    ).length,
                  ),
                )}
              </span>
              <Btn onClick={() => openHabit(chosen)}>{t("edit")}</Btn>
            </div>
            <div className="ld-habit-month-grid">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <div className="ld-habit-month-weekday" key={d}>
                  {t("weekdayShort" + d)}
                </div>
              ))}
              {period.dates.map((d: string) => renderCell(chosen, d, true))}
            </div>
          </>
        )}
        {view !== "day" && habits.length > 0 && (
          <p className="ld-help ld-habit-legend">{t("habitGridLegend")}</p>
        )}
      </div>
    );
  };
}
