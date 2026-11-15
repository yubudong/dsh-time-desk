export function durationSeconds(settings, phase, minutes) {
  if (!["focus", "short", "long"].includes(phase)) throw new Error("阶段无效");
  if (minutes !== undefined) {
    if (phase !== "focus") throw new Error("单次时长只适用于专注阶段");
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)
      throw new Error("专注时长应为 1–180 分钟的整数");
    return minutes * 60;
  }
  return (
    settings[
      { focus: "focusMinutes", short: "shortBreak", long: "longBreak" }[phase]
    ] * 60
  );
}
export function prepareTimerStart(action, onceMinutes) {
  return action.action === "timer" &&
    action.command === "start" &&
    (!action.phase || action.phase === "focus") &&
    action.item?.minutes === undefined &&
    onceMinutes !== null
    ? { ...action, item: { ...action.item, minutes: onceMinutes } }
    : action;
}
export function formatCountdown(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function focusView(timer, settings, now, nextMinutes) {
  const duration =
    timer?.duration || (nextMinutes ?? settings.focusMinutes) * 60;
  const elapsed = timer
    ? Math.min(
        duration,
        Math.max(
          0,
          timer.elapsed +
            (timer.status === "running"
              ? Math.max(0, now - timer.segmentAt) / 1000
              : 0),
        ),
      )
    : 0;
  const remaining = Math.max(0, Math.ceil(duration - elapsed));
  const state = !timer
    ? "ready"
    : remaining === 0 || timer.status === "awaiting"
      ? "finished"
      : timer.status === "paused"
        ? "paused"
        : timer.phase === "focus"
          ? "running"
          : "resting";
  return {
    duration,
    elapsed,
    remaining,
    state,
    display: formatCountdown(remaining),
    ratio: Math.max(0, Math.min(1, remaining / duration)),
  };
}
