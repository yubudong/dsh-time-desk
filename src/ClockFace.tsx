import * as React from "react";
export function ClockFace({
  face = "digital",
  display,
  ratio = 1,
  compact = false,
  reduceMotion = false,
}: any) {
  const id = React.useId().replace(/:/g, "");
  if (compact || face === "digital")
    return (
      <div className="ld-clock-digits" role="timer">
        {display}
      </div>
    );
  if (face === "flip")
    return (
      <div
        className={"ld-clock-flip " + (reduceMotion ? "static" : "")}
        role="timer"
        aria-label={display}
      >
        {display.split(":").map((part: string, i: number) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="ld-flip-colon">:</span>}
            <span className="ld-flip-tile">
              <span key={part} className="ld-flip-value">
                {part}
              </span>
            </span>
          </React.Fragment>
        ))}
      </div>
    );
  if (face === "ring")
    return (
      <div className="ld-clock-ring" role="timer" aria-label={display}>
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle className="ld-clock-track" cx="110" cy="110" r="92" />
          <circle
            className="ld-clock-arc"
            cx="110"
            cy="110"
            r="92"
            pathLength="100"
            strokeDasharray={`${ratio * 100} 100`}
            transform="rotate(-90 110 110)"
          />
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={i}
              x1="110"
              y1="7"
              x2="110"
              y2="14"
              transform={`rotate(${i * 30} 110 110)`}
            />
          ))}
        </svg>
        <span>{display}</span>
      </div>
    );
  return (
    <div className="ld-clock-hourglass" role="timer" aria-label={display}>
      <svg viewBox="0 0 100 110" aria-hidden="true">
        <defs>
          <clipPath id={"top" + id}>
            <path d="M23 17h54L51 50h-2Z" />
          </clipPath>
          <clipPath id={"bottom" + id}>
            <path d="m49 60-26 33h54L51 60Z" />
          </clipPath>
        </defs>
        <path
          className="ld-hourglass-frame"
          d="M20 10h60M20 100h60M24 10v8l23 32v10L24 92v8m52-90v8L53 50v10l23 32v8"
        />
        <rect
          className="ld-sand"
          x="20"
          y={17 + (1 - ratio) * 34}
          width="60"
          height={ratio * 34}
          clipPath={"url(#top" + id + ")"}
        />
        <rect
          className="ld-sand"
          x="20"
          y={93 - (1 - ratio) * 34}
          width="60"
          height={(1 - ratio) * 34}
          clipPath={"url(#bottom" + id + ")"}
        />
        {ratio > 0 && ratio < 1 && (
          <path className="ld-sand-stream" d="M50 51v21" />
        )}
      </svg>
      <span>{display}</span>
    </div>
  );
}
