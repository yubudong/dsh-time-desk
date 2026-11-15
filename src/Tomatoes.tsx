import * as React from "react";
export function Tomatoes({
  completed = 0,
  expected = 0,
  running = false,
  label = "",
}: any) {
  const count = Math.min(6, Math.max(expected, completed));
  return (
    <span
      className="ld-tomatoes"
      aria-label={`${label} ${completed}${expected ? "/" + expected : ""}`}
      title={`${label} ${completed}${expected ? "/" + expected : ""}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <svg
          key={i}
          className={
            "ld-tomato " +
            (i < completed ? "ripe" : "") +
            (running && i === completed ? " growing" : "")
          }
          width="19"
          height="20"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            className="fruit"
            d="M12 7C3 2 0 13 5 19c3 4 11 4 14-1 4-7 0-15-7-11Z"
          />
          <path className="leaf" d="m12 9-5-3 4 1 1-4 1 4 5-1-5 3m-1-4 1-3" />
        </svg>
      ))}
      <span>
        {completed}
        {expected ? " / " + expected : ""}
      </span>
    </span>
  );
}
