import * as React from "react";
import tomato from "../assets/tomato-spirit.png";

/** Static original artwork, matched to the mint Time Spirit illustration. */
export function TomatoIcon({ size = 24 }: { size?: number }) {
  return (
    <img
      src={tomato}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      style={{
        display: "block",
        width: size,
        height: size,
        objectFit: "contain",
        flexShrink: 0,
      }}
    />
  );
}
