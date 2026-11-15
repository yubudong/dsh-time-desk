import * as React from "react";
import animated from "../assets/time-spirit-a.webp";
import still from "../assets/time-spirit-a.png";

/** Approved original A: mint fairy, aqua wings and golden wand, without a hat. */
export function SpiritIcon({
  size = 30,
  reducedMotion = false,
  style,
  ...props
}: any) {
  return (
    <picture
      className="ld-spirit-art"
      aria-hidden="true"
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
        verticalAlign: "middle",
        ...style,
      }}
      {...props}
    >
      <source media="(prefers-reduced-motion: reduce)" srcSet={still} />
      <img
        src={reducedMotion ? still : animated}
        width={size}
        height={size}
        alt=""
        draggable={false}
        decoding="async"
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </picture>
  );
}
