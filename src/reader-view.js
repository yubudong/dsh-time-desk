// Fullscreen modes are view-only: they must never start, stop or change a timer.
export function readerView(mode, now, timeZone, focusDisplay, focusRatio) {
  const isClock = mode === "clock";
  const wallTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return {
    isClock,
    wallTime,
    display: isClock ? wallTime : focusDisplay,
    ratio: isClock ? 1 - (Math.floor(now / 1000) % 60) / 60 : focusRatio,
    showFocus: !isClock,
  };
}
