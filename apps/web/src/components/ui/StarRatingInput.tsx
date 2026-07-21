import { useState } from "react";

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

const STEPS = Array.from({ length: 10 }, (_, i) => (i + 1) / 2); // 0.5 … 5.0

/**
 * Half-star rating input. Each star is two hit zones (left half = .5); hover
 * previews, click commits, clicking your current rating clears it. Keyboard:
 * arrows adjust by half a star, Delete clears. Gold mono glyphs per the
 * design system.
 */
export function StarRatingInput({ value, onChange, onClear, disabled, label = "Your rating" }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Bumped on every commit. Used as a React key so the settle animation
  // restarts — re-adding a class the element already has does not replay a CSS
  // animation, and remounting is the cheapest way to force it. Hover previews
  // deliberately do not bump it: the motion marks the write, not the aim.
  const [commitCount, setCommitCount] = useState(0);
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
      onMouseLeave={() => setHover(null)}
      className="star-input-row"
      style={{ display: "inline-flex", cursor: disabled ? "default" : "pointer", userSelect: "none" }}
    >
      {/* Glyph size comes from the .star-input class rather than an inline
          fontSize so the touch-pointer media query can enlarge it — each half
          star is its own hit zone, and at 24px that is a ~12px target. Inline
          styles would win over the media query. */}
      <span
        key={commitCount}
        className={`star-input${commitCount > 0 ? " star-commit" : ""}`}
        style={{ display: "inline-flex", transformOrigin: "left center" }}
      >
      {[1, 2, 3, 4, 5].map((star) => {
        const half = star - 0.5;
        const glyph = shown >= star ? "★" : shown >= half ? "⯪" : "☆";
        return (
          <span key={star} style={{ position: "relative", fontSize: "inherit", lineHeight: 1 }}>
            <span
              className="stars"
              style={{ fontSize: "inherit", color: shown >= half ? "var(--gold)" : "var(--text-faint)" }}
              aria-hidden
            >
              {glyph === "⯪" ? "★" : glyph}
            </span>
            {/* Half-star mask: cover the right half with the empty color. */}
            {glyph === "⯪" && (
              <span
                aria-hidden
                className="stars"
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  fontSize: "inherit",
                  color: "var(--text-faint)",
                  clipPath: "inset(0 0 0 50%)",
                }}
              >
                ★
              </span>
            )}
            {/* Hit zones */}
            <span
              data-testid={`rate-${half}`}
              style={{ position: "absolute", inset: "0 50% 0 0" }}
              onMouseEnter={() => !disabled && setHover(half)}
              onClick={() => commit(half)}
            />
            <span
              data-testid={`rate-${star}`}
              style={{ position: "absolute", inset: "0 0 0 50%" }}
              onMouseEnter={() => !disabled && setHover(star)}
              onClick={() => commit(star)}
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
