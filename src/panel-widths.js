export const PANEL_WIDTHS = { support: 248, spirit: 370 };
export function panelBounds(kind, containerWidth, navWidth = 0) {
  const width = Number.isFinite(containerWidth)
    ? Math.max(0, containerWidth)
    : 0;
  const max =
    kind === "support"
      ? Math.max(0, Math.min(640, width - 360))
      : Math.max(
          0,
          Math.min(800, width - (width <= 950 ? 60 : navWidth + 320)),
        );
  return { min: Math.min(kind === "support" ? 220 : 280, max), max };
}
export function boundedWidth(value, bounds) {
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, value)));
}
export function parsePanelWidths(text) {
  try {
    const raw = JSON.parse(text),
      out = {};
    for (const kind of Object.keys(PANEL_WIDTHS))
      if (typeof raw?.[kind] === "number" && Number.isFinite(raw[kind]))
        out[kind] = Math.round(
          Math.max(
            kind === "support" ? 220 : 280,
            Math.min(kind === "support" ? 640 : 800, raw[kind]),
          ),
        );
    return out;
  } catch {
    return {};
  }
}
