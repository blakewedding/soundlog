import type { StarBox } from "../../lib/starGeometry";

/**
 * Live pointer diagnostics for the star input, dev builds only.
 *
 * Two real-browser verifications passed while a phone kept failing with the
 * same symptom, so the mapping is no longer the thing under suspicion — the gap
 * between what the harness does and what iOS does is. This prints, on the
 * glass, every input that mapping consumes, so a single drag on the device
 * answers where synthetic and real diverge instead of another round of guessing.
 *
 * Each line exists to discriminate a specific hypothesis:
 *
 *  - `x` vs `pageX` vs `screenX` — a constant offset between them is the
 *    signature of a scrolled or zoomed viewport, where touch coordinates and
 *    getBoundingClientRect() no longer share an origin.
 *  - `vv` (visualViewport scale/offset) — iOS reports rects in the LAYOUT
 *    viewport while a pinch-zoom moves the VISUAL one. Any scale ≠ 1 or offset
 *    ≠ 0 means the two disagree by exactly that much.
 *  - `dpr` — rects and clientX are both CSS pixels, so this should not matter;
 *    printed to rule it out rather than assume it.
 *  - `box[i]` and `cells` — the geometry actually measured at the moment of the
 *    event, not what a resize handler cached earlier.
 *  - `calc` vs `shown` — what the mapping returned versus what React rendered.
 *    If these differ, the bug is in state/render, not geometry.
 *  - `evt` — the event type actually delivered. If iOS is sending touch or
 *    mouse events rather than pointer ones, nothing downstream is comparable.
 */
export interface StarDebugSample {
  evt: string;
  pointerType: string;
  x: number;
  pageX: number;
  screenX: number;
  boxes: StarBox[];
  boxIndex: number | null;
  calc: number | null;
  shown: number;
  dragging: boolean;
}

export function StarDebugReadout({ sample }: { sample: StarDebugSample | null }) {
  if (!import.meta.env.DEV) return null;

  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const n = (v: number) => Math.round(v * 10) / 10;

  const lines: string[] = [
    `build ${__BUILD_STAMP__} ${__BUILD_TIME__.slice(11, 16)}`,
    `dpr ${typeof window !== "undefined" ? window.devicePixelRatio : "?"}  vw ${
      typeof document !== "undefined" ? document.documentElement.clientWidth : "?"
    }`,
    vv
      ? `vv scale ${n(vv.scale)} offL ${n(vv.offsetLeft)} pageL ${n(vv.pageLeft)} w ${n(vv.width)}`
      : "vv unsupported",
  ];

  if (!sample) {
    lines.push("— drag the stars —");
  } else {
    const { evt, pointerType, x, pageX, screenX, boxes, boxIndex, calc, shown, dragging } = sample;
    lines.push(
      `evt ${evt} (${pointerType})${dragging ? " DRAG" : ""}`,
      `x ${n(x)}  pageX ${n(pageX)}  screenX ${n(screenX)}`,
      boxes.length
        ? `cells L${n(boxes[0].left)} w${n(boxes[0].width)} → L${n(boxes[boxes.length - 1].left)}`
        : "cells NONE",
      // `was` is the preview as rendered when this event fired — one frame
      // behind `calc` by construction. They should differ by exactly one step
      // during a drag; if `calc` moves and `was` never follows, the bug is in
      // state/render rather than in the geometry.
      `box ${boxIndex ?? "-"}  calc ${calc ?? "-"}  was ${shown}`
    );
    if (calc !== null && boxes.length === 5) {
      // Where the point sits inside its own box — the number that decides the
      // half. Near 0.50 means a boundary, where an off-by-one hides.
      const i = Math.max(0, Math.min(4, boxIndex ?? 0));
      const frac = (x - boxes[i].left) / boxes[i].width;
      lines.push(`frac ${n(frac * 100)}%  ${frac < 0.5 ? "left half" : "right half"}`);
    }
  }

  return (
    <pre
      aria-hidden
      style={{
        position: "fixed",
        left: 4,
        bottom: 4,
        zIndex: 9999,
        pointerEvents: "none",
        margin: 0,
        font: "10px/1.35 ui-monospace, monospace",
        color: "var(--gold)",
        background: "rgba(10,10,12,0.92)",
        border: "1px solid var(--gold-dim)",
        borderRadius: 3,
        padding: "4px 6px",
        whiteSpace: "pre",
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}
