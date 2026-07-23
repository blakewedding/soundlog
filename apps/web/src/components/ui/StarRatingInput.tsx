import { useRef, useState } from "react";
import { boxesFromElements, stepFromX } from "../../lib/starGeometry";

interface Props {
  value: number | null; // 0.5–5 in half steps, or null = unrated
  onChange: (value: number) => void;
  onClear?: () => void;
  disabled?: boolean;
  /**
   * Accessible name. A release page can show two of these at once (the release
   * rating and the rating attached to a review), and two controls sharing one
   * accessible name is ambiguous for screen readers — so callers distinguish them.
   */
  label?: string;
}

/** Movement past this many pixels turns a press into a drag rather than a tap. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Half-star rating input.
 *
 * Three ways to drive it, all committing the same values:
 *
 *  - **Tap / click** a half-star hit zone (left half of a star = .5). Tapping
 *    your current rating clears it.
 *  - **Press and drag** across the row — the preview follows your finger or
 *    cursor and the release commits. This is the touch path: on a phone there
 *    is no hover, so without it the only way to rate was a precise tap on a
 *    22px zone, and a half-star meant hitting the left sliver of a glyph.
 *  - **Keyboard**: arrows adjust by half a star, Delete clears.
 *
 * Gold mono glyphs per the design system.
 */
export function StarRatingInput({
  value,
  onChange,
  onClear,
  disabled,
  label = "Your rating",
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Bumped on every commit. Used as a React key so the settle animation
  // restarts — re-adding a class the element already has does not replay a CSS
  // animation, and remounting is the cheapest way to force it. Hover previews
  // deliberately do not bump it: the motion marks the write, not the aim.
  const [commitCount, setCommitCount] = useState(0);

  const rowRef = useRef<HTMLSpanElement>(null);
  /**
   * The rendered star boxes. The pointer mapping reads these directly rather
   * than dividing the row width by ten — the boxes flex between a 44px floor
   * and a 64px cap, so the row is not always the same span as the stars.
   */
  const cellRefs = useRef<(HTMLSpanElement | null)[]>([]);
  /** Where the press started, so small jitter still counts as a tap. */
  const pressX = useRef<number | null>(null);
  const isDragging = useRef(false);
  /**
   * A drag ends with a synthetic click on whichever zone the pointer is over.
   * That click would commit a second time, so the drag's own commit sets this
   * and the zone handler consumes it.
   */
  const swallowNextClick = useRef(false);

  const shown = hover ?? value ?? 0;

  function settle() {
    setCommitCount((n) => n + 1);
  }

  function commit(step: number) {
    if (disabled) return;
    if (value === step && onClear) onClear();
    else onChange(step);
    settle();
  }

  /**
   * Which half-star sits under this x coordinate, resolved against the boxes as
   * actually rendered. See lib/starGeometry — deriving it from the row width
   * instead drifted by half a star once the boxes started flexing.
   */
  function stepFromClientX(clientX: number): number | null {
    return stepFromX(boxesFromElements(cellRefs.current), clientX);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (disabled) return;
    pressX.current = e.clientX;
    isDragging.current = false;
    // Capture so the drag keeps tracking after the finger leaves the row, and
    // so pointerup lands here rather than on whatever is underneath.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (disabled) return;

    if (pressX.current !== null) {
      if (!isDragging.current && Math.abs(e.clientX - pressX.current) > DRAG_THRESHOLD_PX) {
        isDragging.current = true;
      }
      if (isDragging.current) {
        const step = stepFromClientX(e.clientX);
        if (step !== null) setHover(step);
      }
      return;
    }

    // Not pressed: hover preview, which only a fine pointer can produce. Touch
    // devices never reach here without a press, so a finger resting mid-scroll
    // cannot change the preview.
    if (e.pointerType !== "touch") {
      const step = stepFromClientX(e.clientX);
      if (step !== null) setHover(step);
    }
  }

  function endPress(e: React.PointerEvent, commitIt: boolean) {
    if (pressX.current === null) return;
    const wasDragging = isDragging.current;
    pressX.current = null;
    isDragging.current = false;

    if (commitIt && wasDragging) {
      const step = stepFromClientX(e.clientX) ?? hover;
      swallowNextClick.current = true;
      setHover(null);
      if (step !== null) commit(step);
      return;
    }
    // A tap: leave it to the hit zone's click handler, which is also what a
    // mouse click and a keyboard-driven click go through.
    if (!wasDragging) return;
    setHover(null);
  }

  function onPointerUp(e: React.PointerEvent) {
    endPress(e, true);
  }

  function onPointerCancel(e: React.PointerEvent) {
    // Scroll took over, or the gesture was interrupted — abandon without writing.
    endPress(e, false);
    setHover(null);
  }

  function onZoneClick(step: number) {
    if (swallowNextClick.current) {
      swallowNextClick.current = false;
      return;
    }
    commit(step);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, (value ?? 0) + 0.5));
      settle();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (value ?? 0.5) - 0.5;
      if (next >= 0.5) onChange(next);
      else onClear?.();
      settle();
    } else if ((e.key === "Delete" || e.key === "Backspace") && onClear) {
      e.preventDefault();
      onClear();
      settle();
    }
  }

  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0.5}
      aria-valuemax={5}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value ? `${value} out of 5` : "Not rated"}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (pressX.current === null) setHover(null);
      }}
      className="star-input-row"
      style={{
        // `display` lives in theme.css, not here: touch layouts widen the star
        // boxes by letting the row grow, and an inline style would win over the
        // media query that does it.
        cursor: disabled ? "default" : "pointer",
        userSelect: "none",
        // Vertical scrolling still belongs to the page; horizontal movement is
        // ours, so a drag across the stars is never stolen by the scroller.
        touchAction: "pan-y",
      }}
    >
      {/* Keyed wrapper: remounting replays star-settle. Focus lives on the
          slider above, so this never steals or drops it. */}
      <span
        key={commitCount}
        ref={rowRef}
        className={`star-input${commitCount > 0 ? " star-commit" : ""}`}
        style={{ transformOrigin: "left center" }}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const half = star - 0.5;
          // One of three, from whatever is being shown — value at rest, hover
          // preview, or drag preview. Exposed as data-fill so the rendered fill
          // is assertable: the numeric readout agreeing with the value is not
          // evidence that the stars do.
          const fill = shown >= star ? "full" : shown >= half ? "half" : "empty";
          return (
            <span
              key={star}
              ref={(el) => {
                cellRefs.current[star - 1] = el;
              }}
              className="star-cell"
              data-fill={fill}
              data-testid={`star-${star}`}
              style={{ fontSize: "inherit", lineHeight: 1 }}
            >
              {/* The glyph box shrink-wraps the star, and the half mask is
                  anchored to IT rather than to the cell. The cell is the hit
                  target, not the mark: on touch it flexes to 44–64px while the
                  glyph stays ~0.6em, so a mask at 50% of the cell landed
                  entirely off the glyph and every half rendered as a whole
                  star. See .star-glyph in theme.css. */}
              <span
                className="star-glyph"
                style={{ fontSize: "inherit", color: fill === "empty" ? "var(--text-faint)" : "var(--gold)" }}
                aria-hidden
              >
                {fill === "empty" ? "☆" : "★"}
                {fill === "half" && (
                  <span aria-hidden className="star-glyph-half">
                    ★
                  </span>
                )}
              </span>
              {/* Hit zones — the tap path. Drag is handled on the row above. */}
              <span
                data-testid={`rate-${half}`}
                style={{ position: "absolute", inset: "0 50% 0 0" }}
                onClick={() => onZoneClick(half)}
              />
              <span
                data-testid={`rate-${star}`}
                style={{ position: "absolute", inset: "0 0 0 50%" }}
                onClick={() => onZoneClick(star)}
              />
            </span>
          );
        })}
      </span>
      <span className="meta" style={{ marginLeft: 8, alignSelf: "center", minWidth: 28 }}>
        {shown > 0 ? shown.toFixed(1) : ""}
      </span>
    </div>
  );
}
