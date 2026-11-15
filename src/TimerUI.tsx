import * as React from "react";
import { ClockFace } from "./ClockFace";
import { Tomatoes } from "./Tomatoes";
import { taskFocus } from "./today-view.js";
import { focusView, prepareTimerStart } from "./focus-state.js";
import { today, occurrences } from "./dates.js";
import { readerView } from "./reader-view.js";
const { useState, useEffect, useRef, useSyncExternalStore } = React;
const FACES = ["digital", "ring", "flip", "hourglass"];

export function createTimerUI({ useStore, act, t, ctx }: any) {
  let ui: any = {
      minutes: null,
      reader: false,
      selection: { taskId: "", originalDate: "" },
    },
    disposed = false;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const setUI = (patch: any) => {
    if (disposed) return;
    ui = { ...ui, ...patch };
    listeners.forEach((fn) => fn());
  };
  function useModel() {
    const store = useStore(),
      local = useSyncExternalStore(subscribe, () => ui);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, []);
    const data = store.data;
    if (!data) return null;
    const timer = data.timer,
      view = focusView(timer, data.settings, now, local.minutes);
    const taskId = timer?.taskId || local.selection.taskId;
    const task = data.tasks.find(
      (x: any) =>
        x.id === taskId && !x.deletedAt && (timer || x.status !== "done"),
    );
    const day = today(data.settings.timeZone, now);
    const records = data.focusLogs.filter(
      (x: any) => !x.deletedAt && x.date === day,
    );
    return {
      ...store,
      data,
      local,
      now,
      timer,
      ...view,
      task,
      progress: task
        ? taskFocus(
            data,
            task,
            timer?.originalDate || local.selection.originalDate,
          )
        : null,
      round: records.filter((x: any) => x.completed).length,
      recordedMinutes: Math.floor(
        records.reduce((sum: number, x: any) => sum + x.seconds, 0) / 60,
      ),
      nextMinutes: local.minutes ?? data.settings.focusMinutes,
    };
  }
  async function call(a: any) {
    try {
      return await act(a);
    } catch {
      return null;
    }
  }
  function status(m: any) {
    return m.timer && m.timer.phase !== "focus" && m.state === "finished"
      ? t("restComplete")
      : t("timerState" + m.state);
  }
  function caption(m: any) {
    return m.timer && m.timer.phase !== "focus"
      ? t(m.timer.phase === "long" ? "longBreak" : "shortBreak")
      : m.timer?.title || m.task?.title || t("directFocus");
  }
  function TaskProgress({ m }: any) {
    if (!m.task) return null;
    return (
      <div className="ld-timer-task-progress">
        <span>{t("taskProgressLabel")}</span>
        {m.progress.expected > 0 ? (
          <>
            <Tomatoes {...m.progress} label={t("taskTomatoes")} />
            <span>
              {t("roundsCompleted")} {m.progress.completed} /{" "}
              {t("roundsEstimated")} {m.progress.expected}
            </span>
          </>
        ) : (
          <span>
            {t("roundsCompleted")} {m.progress.completed} {t("tomatoUnit")} ·{" "}
            {t("estimateUnset")}
          </span>
        )}
      </div>
    );
  }
  function TaskSelector({ m }: any) {
    if (m.timer)
      return (
        <div className="ld-timer-task-name" title={caption(m)}>
          {caption(m)}
        </div>
      );
    const d = today(m.data.settings.timeZone, m.now);
    const recurring = occurrences(m.data, d, d).filter(
      (x: any) =>
        x.repeat.kind !== "none" &&
        !x.event &&
        !["done", "skipped", "cancelled"].includes(x.status),
    );
    const options = [
      ...m.data.tasks
        .filter(
          (x: any) =>
            !x.deletedAt &&
            !x.event &&
            x.status !== "done" &&
            x.repeat.kind === "none",
        )
        .map((x: any) => ({
          taskId: x.id,
          originalDate: x.date,
          title: x.title,
        })),
      ...recurring.map((x: any) => ({
        taskId: x.id,
        originalDate: x.originalDate,
        title: x.title,
      })),
    ];
    const current = options.find(
      (x: any) =>
        x.taskId === m.local.selection.taskId &&
        x.originalDate === m.local.selection.originalDate,
    );
    return (
      <select
        className="ld-timer-task-select"
        aria-label={t("selectTask")}
        value={
          current
            ? JSON.stringify({
                taskId: current.taskId,
                originalDate: current.originalDate,
              })
            : ""
        }
        onChange={(e) =>
          setUI({
            selection: e.target.value
              ? JSON.parse(e.target.value)
              : { taskId: "", originalDate: "" },
          })
        }
      >
        <option value="">{t("directFocus")}</option>
        {options.map((x: any) => (
          <option
            key={x.taskId + x.originalDate}
            value={JSON.stringify({
              taskId: x.taskId,
              originalDate: x.originalDate,
            })}
          >
            {x.title}
          </option>
        ))}
      </select>
    );
  }
  function Controls({ m, reader = false, clockMode = false }: any) {
    const [panel, setPanel] = useState(""),
      [minutes, setMinutes] = useState(String(m.nextMinutes)),
      [error, setError] = useState(""),
      [adjust, setAdjust] = useState(""),
      [ending, setEnding] = useState(false),
      [pausedForReview, setPausedForReview] = useState(false),
      [notice, setNotice] = useState(""),
      [estimate, setEstimate] = useState(String(m.task?.pomodoros || 0));
    useEffect(() => {
      setEnding(false);
      setAdjust("");
      setPausedForReview(false);
    }, [m.timer?.id]);
    useEffect(() => {
      setPanel("");
    }, [clockMode]);
    const start = async (phase = "focus") => {
      const task =
        phase === "focus" && m.task && m.task.status !== "done"
          ? m.local.selection
          : { taskId: "", originalDate: "" };
      await call({
        action: "timer",
        command: "start",
        phase,
        round: m.round,
        ...task,
      });
    };
    const finish = async (save: boolean, rest = false) => {
      if (!m.timer) return;
      const completed =
        save &&
        m.timer.phase === "focus" &&
        (adjust === "" ? m.elapsed : Number(adjust)) >= m.duration;
      const nextRound = m.round + (completed ? 1 : 0);
      const result = await call({
        action: "timer",
        command: save ? "finish" : "discard",
        timerId: m.timer.id,
        ...(adjust !== "" ? { seconds: Number(adjust) } : {}),
      });
      if (result) {
        setEnding(false);
        setAdjust("");
        setNotice(t(save ? "sessionRecorded" : "sessionDiscarded"));
        if (rest)
          await call({
            action: "timer",
            command: "start",
            phase: nextRound > 0 && nextRound % 4 === 0 ? "long" : "short",
            round: nextRound,
          });
      }
    };
    const applyMinutes = async (makeDefault: boolean) => {
      const n = Number(minutes);
      if (!Number.isInteger(n) || n < 1 || n > 180) {
        setError(t("durationInvalid"));
        return;
      }
      setError("");
      if (makeDefault) {
        if (await call({ action: "settings", item: { focusMinutes: n } })) {
          setUI({ minutes: null });
          setPanel("");
        }
      } else {
        setUI({ minutes: n });
        setPanel("");
      }
    };
    return (
      <div
        className={
          "ld-timer-controls " + (reader ? "ld-reader-timer-controls" : "")
        }
      >
        {!clockMode && (
          <div className="ld-timer-buttons">
            {!m.timer ? (
              <button
                type="button"
                className="ld-btn ld-primary"
                disabled={m.busy}
                onClick={() => void start()}
              >
                {t("startFocus")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ld-btn"
                  disabled={m.busy || m.state === "finished"}
                  onClick={() =>
                    void call({
                      action: "timer",
                      command: m.timer.status === "paused" ? "resume" : "pause",
                      timerId: m.timer.id,
                    })
                  }
                >
                  {t(m.timer.status === "paused" ? "resume" : "pause")}
                </button>
                <button
                  type="button"
                  className="ld-btn ld-primary"
                  disabled={m.busy}
                  onClick={async () => {
                    if (
                      m.timer.status === "running" &&
                      m.state !== "finished"
                    ) {
                      if (
                        !(await call({
                          action: "timer",
                          command: "pause",
                          timerId: m.timer.id,
                        }))
                      )
                        return;
                      setPausedForReview(true);
                    }
                    setEnding(true);
                    setPanel("");
                    setNotice("");
                  }}
                >
                  {t(m.state === "finished" ? "confirmRound" : "endRound")}
                </button>
              </>
            )}
            {!m.timer && m.round > 0 && (
              <button
                type="button"
                className="ld-btn"
                disabled={m.busy}
                onClick={() => void start(m.round % 4 === 0 ? "long" : "short")}
              >
                {t("break")}
              </button>
            )}
          </div>
        )}
        <div className="ld-timer-preferences">
          {!clockMode && (
            <button
              type="button"
              aria-expanded={panel === "duration"}
              onClick={() => {
                setMinutes(String(m.nextMinutes));
                setError("");
                setPanel(panel === "duration" ? "" : "duration");
              }}
            >
              {t(m.timer ? "nextDuration" : "focusDuration")} {m.nextMinutes}{" "}
              {t("min")} ▾
            </button>
          )}
          <button
            type="button"
            aria-expanded={panel === "face"}
            onClick={() => setPanel(panel === "face" ? "" : "face")}
          >
            {t("clockFace")} ▾
          </button>
          {!reader && (
            <button type="button" onClick={() => setUI({ reader: true })}>
              {t("fullscreenFocus")} ⛶
            </button>
          )}
          {!clockMode && (
            <button
              type="button"
              aria-expanded={panel === "stats"}
              onClick={() => setPanel(panel === "stats" ? "" : "stats")}
            >
              {t(panel === "stats" ? "closeStats" : "moreFocus")}{" "}
              {panel === "stats" ? "⌃" : "⌄"}
            </button>
          )}
        </div>
        {!clockMode && panel === "duration" && (
          <div className="ld-timer-drawer">
            <strong>{t("setFocusDuration")}</strong>
            <p className="ld-help">
              {t(m.timer ? "durationNextOnly" : "durationScopeHint")}
            </p>
            <div className="ld-duration-presets">
              {[10, 15, 25, 45, 60].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={Number(minutes) === n}
                  onClick={() => setMinutes(String(n))}
                >
                  {n}
                </button>
              ))}
            </div>
            <label className="ld-field">
              <span>{t("customMinutes")}</span>
              <input
                type="number"
                min="1"
                max="180"
                required
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            {error && (
              <p className="ld-error" role="alert">
                {error}
              </p>
            )}
            <div className="ld-actions">
              <button
                type="button"
                className="ld-btn ld-primary"
                disabled={m.busy}
                onClick={() => void applyMinutes(false)}
              >
                {t("useOnce")}
              </button>
              <button
                type="button"
                className="ld-btn"
                disabled={m.busy}
                onClick={() => void applyMinutes(true)}
              >
                {t("setDefault")}
              </button>
            </div>
          </div>
        )}
        {panel === "face" && (
          <div className="ld-timer-drawer">
            <strong>{t("clockFace")}</strong>
            <div className="ld-face-options">
              {FACES.map((face) => (
                <button
                  type="button"
                  key={face}
                  disabled={m.busy}
                  aria-pressed={m.data.settings.timerFace === face}
                  onClick={async () => {
                    if (
                      await call({
                        action: "settings",
                        item: { timerFace: face },
                      })
                    )
                      setPanel("");
                  }}
                >
                  <ClockFace
                    face={face}
                    display="25:00"
                    ratio={0.72}
                    reduceMotion
                  />
                  <span>{t("face" + face)}</span>
                </button>
              ))}
            </div>
            <label className="ld-check-label">
              <input
                type="checkbox"
                checked={m.data.settings.reduceMotion}
                disabled={m.busy}
                onChange={(e) =>
                  void call({
                    action: "settings",
                    item: { reduceMotion: e.target.checked },
                  })
                }
              />
              {t("reduceClockMotion")}
            </label>
          </div>
        )}
        {!clockMode && panel === "stats" && (
          <div className="ld-timer-drawer">
            <div className="ld-focus-stat">
              <span>{t("todayTomatoes")}</span>
              <strong>
                {m.round} {t("tomatoUnit")}
              </strong>
            </div>
            <div className="ld-focus-stat">
              <span>{t("focused")}</span>
              <strong>
                {m.recordedMinutes} {t("min")}
              </strong>
            </div>
            <p className="ld-help">
              {m.round > 0 && m.round % 4 === 0
                ? t("longBreakReady")
                : t("untilLongBreak") +
                  " " +
                  (4 - (m.round % 4)) +
                  " " +
                  t("roundUnit")}
            </p>
            {m.task && (
              <>
                <label className="ld-field">
                  <span>{t("estimatedTomatoes")}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="ld-btn"
                  disabled={m.busy}
                  onClick={() =>
                    void call({
                      action: "save",
                      collection: "tasks",
                      id: m.task.id,
                      version: m.task.version,
                      item: { pomodoros: Number(estimate) },
                    })
                  }
                >
                  {t("save")}
                </button>
              </>
            )}
          </div>
        )}
        {!clockMode && ending && m.timer && (
          <div className="ld-timer-drawer ld-end-review">
            <strong>
              {t(m.state === "finished" ? "roundComplete" : "endRound")}
            </strong>
            <p className="ld-help">
              {t(m.state === "finished" ? "completeReviewHint" : "interrupted")}
            </p>
            {m.timer.phase === "focus" && (
              <label className="ld-field">
                <span>{t("seconds")}</span>
                <input
                  type="number"
                  min="0"
                  max={Math.floor(m.elapsed)}
                  value={adjust}
                  placeholder={String(Math.floor(m.elapsed))}
                  onChange={(e) => setAdjust(e.target.value)}
                />
              </label>
            )}
            <div className="ld-actions">
              <button
                type="button"
                className="ld-btn ld-primary"
                disabled={m.busy}
                onClick={() => void finish(true)}
              >
                {t(m.timer.phase === "focus" ? "finish" : "finishRest")}
              </button>
              {m.timer.phase === "focus" && m.state === "finished" && (
                <button
                  type="button"
                  className="ld-btn"
                  disabled={m.busy}
                  onClick={() => void finish(true, true)}
                >
                  {t("saveAndRest")}
                </button>
              )}
              <button
                type="button"
                className="ld-btn"
                disabled={m.busy}
                onClick={() => void finish(false)}
              >
                {t(m.timer.phase === "focus" ? "discard" : "skipRest")}
              </button>
              <button
                type="button"
                className="ld-btn"
                onClick={async () => {
                  if (pausedForReview && m.timer.status === "paused") {
                    if (
                      !(await call({
                        action: "timer",
                        command: "resume",
                        timerId: m.timer.id,
                      }))
                    )
                      return;
                  }
                  setPausedForReview(false);
                  setEnding(false);
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
        {m.error && (
          <p className="ld-error" role="alert">
            {m.error}
          </p>
        )}
        {notice && (
          <p className="ld-help" role="status">
            {notice}
          </p>
        )}
      </div>
    );
  }
  function Timer({ compact = false, bar = false }: any) {
    const m = useModel();
    if (!m) return null;
    if (compact)
      return m.timer ? (
        <button
          type="button"
          className="ld-global-timer"
          title={status(m) + " · " + t("timeRemaining") + " " + m.display}
          onClick={() => ctx.layout.selectPanel("life-desk")}
        >
          <span aria-hidden="true">◷</span>
          <span>{m.display}</span>
        </button>
      ) : null;
    return (
      <section
        className={"ld-focus-card ld-timer-v2 " + (bar ? "ld-timer-bar" : "")}
        aria-label={t("focus")}
      >
        <div className="ld-timer-overview">
          <div className="ld-timer-context">
            <span className={"ld-timer-state state-" + m.state}>
              {status(m)}
            </span>
            <TaskSelector m={m} />
          </div>
          <div className="ld-timer-time">
            <span className="ld-timer-time-label">
              {t(m.state === "ready" ? "plannedDuration" : "timeRemaining")}
            </span>
            <ClockFace
              face={m.data.settings.timerFace}
              compact={bar}
              display={m.display}
              ratio={m.ratio}
              reduceMotion={m.data.settings.reduceMotion}
            />
          </div>
        </div>
        <TaskProgress m={m} />
        <Controls m={m} />
      </section>
    );
  }
  function Fullscreen() {
    const m = useModel();
    const root = useRef<HTMLElement>(null),
      previous = useRef<HTMLElement | null>(null),
      wake = useRef<any>(null),
      timeout = useRef<any>(null),
      focusModeButton = useRef<HTMLButtonElement>(null),
      clockModeButton = useRef<HTMLButtonElement>(null);
    const [visible, setVisible] = useState(true),
      [native, setNative] = useState(false),
      [mode, setMode] = useState<"focus" | "clock">("focus");
    const open = !!m?.local.reader;
    useEffect(() => {
      if (!open) return;
      let active = true,
        entered = false;
      previous.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const element = root.current;
      if (!element) return;
      element.focus();
      setMode("focus");
      setVisible(true);
      const reset = () => {
        setVisible(true);
        clearTimeout(timeout.current);
        timeout.current = setTimeout(() => {
          if (
            active &&
            !element.querySelector(".ld-timer-drawer") &&
            !element.matches(
              ":focus-within:has(input:focus,select:focus,textarea:focus)",
            )
          )
            setVisible(false);
        }, 4500);
      };
      // Keep these native fullscreen controls independent of delegated events
      // on the surrounding slot; all listeners belong to this reader instance.
      const focusButton = focusModeButton.current;
      const clockButton = clockModeButton.current;
      const chooseFocus = () => {
        setMode("focus");
        reset();
      };
      const chooseClock = () => {
        setMode("clock");
        reset();
      };
      focusButton?.addEventListener("click", chooseFocus);
      clockButton?.addEventListener("click", chooseClock);
      const close = () => setUI({ reader: false });
      const change = () => {
        const owned = document.fullscreenElement === element;
        setNative(owned);
        if (owned) entered = true;
        else if (entered) close();
      };
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          return;
        }
        reset();
        if (e.key === "Tab") {
          const targets = Array.from(
            element.querySelectorAll<HTMLElement>(
              "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
            ),
          ).filter((x) => x.getClientRects().length > 0);
          const first = targets[0],
            last = targets.at(-1);
          if (!first) return;
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === element)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              !element.contains(document.activeElement))
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      let lockPending = false;
      const lock = async () => {
        if (lockPending) return;
        try {
          if (
            (navigator as any).wakeLock &&
            document.visibilityState === "visible" &&
            !wake.current
          ) {
            lockPending = true;
            const value = await (navigator as any).wakeLock.request("screen");
            if (active) wake.current = value;
            else await value.release();
          }
        } catch {
        } finally {
          lockPending = false;
        }
      };
      const visibility = () => {
        if (document.visibilityState === "visible") {
          if (wake.current?.released) wake.current = null;
          void lock();
        }
      };
      document.addEventListener("fullscreenchange", change);
      window.addEventListener("keydown", key, true);
      document.addEventListener("visibilitychange", visibility);
      element.addEventListener("pointermove", reset);
      element.addEventListener("pointerdown", reset);
      element.addEventListener("focusin", reset);
      if (!document.fullscreenElement && element.requestFullscreen) {
        void element
          .requestFullscreen()
          .then(() => {
            if (!active && document.fullscreenElement === element)
              void document.exitFullscreen().catch(() => {});
          })
          .catch(() => {
            if (active) setNative(false);
          });
      }
      void lock();
      reset();
      return () => {
        active = false;
        clearTimeout(timeout.current);
        focusButton?.removeEventListener("click", chooseFocus);
        clockButton?.removeEventListener("click", chooseClock);
        document.removeEventListener("fullscreenchange", change);
        window.removeEventListener("keydown", key, true);
        document.removeEventListener("visibilitychange", visibility);
        element.removeEventListener("pointermove", reset);
        element.removeEventListener("pointerdown", reset);
        element.removeEventListener("focusin", reset);
        if (document.fullscreenElement === element)
          void document.exitFullscreen().catch(() => {});
        const held = wake.current;
        wake.current = null;
        if (held) void held.release().catch(() => {});
        if (previous.current?.isConnected) previous.current.focus();
      };
    }, [open]);
    useEffect(() => {
      if (m?.state === "finished") setVisible(true);
    }, [m?.state]);
    if (!m || !open) return null;
    const displayView = readerView(
      mode,
      m.now,
      m.data.settings.timeZone,
      m.display,
      m.ratio,
    );
    const clock = displayView.isClock;
    const actualClock = displayView.wallTime;
    return (
      <section
        ref={root}
        className={
          "ld-reader " +
          (visible ? "controls-visible" : "controls-hidden") +
          " " +
          (m.data.settings.reduceMotion ? "reduce-motion" : "")
        }
        style={
          {
            "--reader-brightness": m.data.settings.displayBrightness / 100,
            WebkitAppRegion: "no-drag",
          } as any
        }
        data-reader-mode={mode}
        data-reader-version={__LIFE_DESK_VERSION__}
        role="dialog"
        aria-modal="true"
        aria-label={t("fullscreenFocus")}
        tabIndex={-1}
      >
        <header className="ld-reader-top ld-reader-auto-hide">
          <div className="ld-reader-mode">
            <button
              type="button"
              ref={focusModeButton}
              style={{ WebkitAppRegion: "no-drag" } as any}
              aria-pressed={!clock}
              onClick={() => {
                setMode("focus");
                setVisible(true);
              }}
            >
              {t("countdownMode")}
            </button>
            <button
              type="button"
              ref={clockModeButton}
              style={{ WebkitAppRegion: "no-drag" } as any}
              aria-pressed={clock}
              onClick={() => {
                setMode("clock");
                setVisible(true);
              }}
            >
              {t("wallClockMode")}
            </button>
          </div>
          <div>
            <span>{t(native ? "nativeFullscreen" : "appFullscreen")}</span>
            {!native && (
              <button
                type="button"
                disabled={!document.fullscreenEnabled}
                onClick={() => {
                  if (root.current?.requestFullscreen)
                    void root.current.requestFullscreen().catch(() => {});
                }}
              >
                {t("tryNativeFullscreen")}
              </button>
            )}
            <button type="button" onClick={() => setUI({ reader: false })}>
              {t("exitFullscreen")} ⛶
            </button>
          </div>
        </header>
        <div className="ld-reader-display">
          <div className="ld-reader-caption">
            {clock ? t("wallClockMode") : caption(m)}
          </div>
          <div className={"ld-timer-state state-" + m.state}>
            {clock ? (m.timer ? t("timerContinues") : "") : status(m)}
          </div>
          <ClockFace
            face={m.data.settings.timerFace}
            display={displayView.display}
            ratio={displayView.ratio}
            reduceMotion={m.data.settings.reduceMotion}
          />
          {displayView.showFocus && (
            <>
              <span className="ld-reader-remaining">
                {t(
                  m.state === "ready"
                    ? "plannedDuration"
                    : m.state === "finished"
                      ? "roundComplete"
                      : "timeRemaining",
                )}
              </span>
              <TaskProgress m={m} />
              <div className="ld-reader-current">
                {t("currentWallTime")} {actualClock.slice(0, 5)}
              </div>
            </>
          )}
        </div>
        <footer className="ld-reader-bottom ld-reader-auto-hide">
          <Controls m={m} reader clockMode={clock} />
          <label className="ld-reader-brightness">
            <span>{t("displayBrightness")}</span>
            <input
              type="range"
              disabled={m.busy}
              min="40"
              max="100"
              step="5"
              aria-label={t("displayBrightness")}
              defaultValue={m.data.settings.displayBrightness}
              onChange={(e) => {
                const value = e.target.value;
                root.current?.style.setProperty(
                  "--reader-brightness",
                  String(Number(value) / 100),
                );
              }}
              onPointerUp={(e) =>
                void call({
                  action: "settings",
                  item: { displayBrightness: Number(e.currentTarget.value) },
                })
              }
              onKeyUp={(e) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(e.key)
                )
                  void call({
                    action: "settings",
                    item: { displayBrightness: Number(e.currentTarget.value) },
                  });
              }}
            />
          </label>
          <p>
            {t("fullscreenHint")}{" "}
            <small className="ld-reader-build">v{__LIFE_DESK_VERSION__}</small>
          </p>
        </footer>
      </section>
    );
  }
  return {
    Timer,
    Fullscreen,
    prepare(a: any) {
      return prepareTimerStart(a, ui.minutes);
    },
    didStart(a: any) {
      if (
        a.action === "timer" &&
        a.command === "start" &&
        (!a.phase || a.phase === "focus")
      )
        setUI({
          minutes: null,
          selection: {
            taskId: a.taskId || "",
            originalDate: a.originalDate || "",
          },
        });
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
