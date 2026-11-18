import * as React from "react";
import {
  PANEL_WIDTHS,
  panelBounds,
  boundedWidth,
  parsePanelWidths,
} from "./panel-widths.js";
const { useState, useRef, useEffect } = React;
type Kind = "support" | "spirit";
const KEY = "lifeDesk:panelWidths:v1";
export function usePanelWidths() {
  const [widths, setWidths] = useState<any>(() => {
    try {
      return parsePanelWidths(localStorage.getItem(KEY));
    } catch {
      return {};
    }
  });
  const current = useRef(widths);
  const change = (kind: Kind, value: number | undefined, save = false) => {
    const next = { ...current.current };
    if (value === undefined) delete next[kind];
    else next[kind] = value;
    current.current = next;
    setWidths(next);
    if (save)
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
  };
  return { widths, change };
}
export function PanelResize({
  kind,
  label,
  value,
  onChange,
}: {
  kind: Kind;
  label: string;
  value?: number;
  onChange: (kind: Kind, value: number | undefined, save?: boolean) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<any>(null);
  const [metrics, setMetrics] = useState({
    min: 0,
    max: 800,
    width: PANEL_WIDTHS[kind],
  });
  const [active, setActive] = useState(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const measure = () => {
    const panel = handle.current?.parentElement;
    const container = panel?.parentElement;
    if (!panel || !container) return null;
    const nav =
      kind === "spirit"
        ? container.querySelector(".ld-nav")?.getBoundingClientRect().width || 0
        : 0;
    return {
      ...panelBounds(kind, container.getBoundingClientRect().width, nav),
      width: panel.getBoundingClientRect().width,
    };
  };
  const release = () => {
    if (drag.current) {
      drag.current.restore();
      drag.current = null;
      setActive(false);
    }
  };
  useEffect(() => {
    const panel = handle.current?.parentElement,
      container = panel?.parentElement;
    const update = () => {
      const next = measure();
      if (next) setMetrics(next);
    };
    const observer = new ResizeObserver(update);
    if (panel) observer.observe(panel);
    if (container) observer.observe(container);
    update();
    return () => {
      observer.disconnect();
      if (drag.current) {
        const original = drag.current.original;
        drag.current.restore();
        drag.current = null;
        changeRef.current(kind, original);
      }
    };
  }, [kind]);
  const cancel = () => {
    if (!drag.current) return;
    const original = drag.current.original;
    release();
    onChange(kind, original);
  };
  return (
    <div
      ref={handle}
      className={
        "ld-panel-resizer ld-resize-" + kind + (active ? " is-resizing" : "")
      }
      role="separator"
      tabIndex={0}
      aria-label={label}
      title={label}
      aria-orientation="vertical"
      aria-valuemin={metrics.min}
      aria-valuemax={metrics.max}
      aria-valuenow={Math.round(metrics.width)}
      onDoubleClick={() => onChange(kind, undefined, true)}
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return;
        const m = measure();
        if (!m) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        const doc = e.currentTarget.ownerDocument;
        const cursor = doc.body.style.cursor,
          userSelect = doc.body.style.userSelect;
        doc.body.style.cursor = "col-resize";
        doc.body.style.userSelect = "none";
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          width: m.width,
          original: value,
          last: m.width,
          restore: () => {
            doc.body.style.cursor = cursor;
            doc.body.style.userSelect = userSelect;
          },
        };
        setActive(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const m = measure();
        if (!m) return;
        d.last = boundedWidth(d.width + d.x - e.clientX, m);
        onChange(kind, d.last);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const final = d.last;
        release();
        onChange(kind, final, true);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onChange(kind, undefined, true);
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const m = measure();
        if (!m) return;
        const next =
          e.key === "Home"
            ? m.min
            : e.key === "End"
              ? m.max
              : m.width +
                (e.key === "ArrowLeft" ? 1 : -1) * (e.shiftKey ? 40 : 10);
        onChange(kind, boundedWidth(next, m), true);
      }}
    />
  );
}
