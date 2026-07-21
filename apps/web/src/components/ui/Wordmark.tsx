interface Props {
  /**
   * Draw the hairline gold rule beneath the letterforms. Defaults by size —
   * see below — so call sites don't have to remember the policy.
   */
  rule?: boolean;
  /** Cap height in px. The nav uses 20; display lockups are 32 and up. */
  size?: number;
}

/** Below this the rule fights the surrounding chrome; above it, it earns its keep. */
const RULE_MIN_SIZE = 32;

/**
 * The Soundlog wordmark — the only place the mark is drawn.
 *
 * One treatment: the Groove glyph leading Struck letterforms. Tight Archivo
 * caps, LOG in flat gold, and a hairline gold rule inset beneath.
 * No gradients or foil effects anywhere — the gold is flat by design, so it
 * survives being rendered at 16px, printed, or stamped on a sticker.
 *
 * The rule is size-dependent, not a per-call-site choice. At nav scale it sits
 * within ~20px of the nav's own bottom border and the two read as a mistake;
 * it is also a single physical pixel there, so it softens on non-retina. At
 * display sizes it reads clearly as a lead-in groove and rhymes with the
 * glyph's arcs. Encoding that as a default keeps the two from drifting apart
 * as call sites multiply; pass `rule` explicitly to override.
 */
export function Wordmark({ size = 20, rule = size >= RULE_MIN_SIZE }: Props) {
  return (
    <span className={`wordmark${rule ? " wordmark-ruled" : ""}`} style={{ fontSize: size }}>
      <GrooveMark size={size} />
      <span className="wordmark-text">
        Sound<em>log</em>
      </span>
    </span>
  );
}

/**
 * The glyph. Two open concentric arcs around a gold centre — a groove and a
 * label ring, abstract rather than a drawing of a record.
 *
 * Optically sized. Strokes are specified in a 24-unit box, so a naive scale to
 * 16px would render them at 0.7px — a grey smear. Two cuts, and the threshold
 * matters: the open-arc cut needs *both* grooves visible to read as rotation.
 * Drop one and the survivor reads as a crescent moon, which is exactly what
 * happened at 20px before the threshold moved down to 18.
 *
 * Below 18px the glyph switches to a closed cut — a gold label ring around a
 * spindle. Gaps cannot resolve in 16 pixels, so it stops trying to show them
 * and shows the ring instead. Same idea as an optical size in a type family:
 * the small cut is not the big cut shrunk.
 *
 * The closed cut is also the geometry the placeholder icon assets are drawn
 * from — see `apps/web/scripts/generate-icons.mjs`, which reproduces these
 * exact proportions.
 */
export function GrooveMark({ size = 20 }: { size?: number }) {
  const compact = size < 18;
  const stroke = compact ? 3.2 : size < 44 ? 2.2 : 1.6;

  return (
    <svg
      className="wordmark-glyph"
      viewBox="0 0 24 24"
      width={size * 1.15}
      height={size * 1.15}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {compact ? (
        <>
          {/* Label ring — closed, so it can never read as a crescent. */}
          <circle cx="12" cy="12" r="7" stroke="var(--gold)" strokeWidth={stroke} />
          <circle cx="12" cy="12" r="1.9" fill="var(--text)" />
        </>
      ) : (
        <>
          {/* Outer groove: 270° sweep, gap at the upper left. */}
          <path
            d="M 5.64 5.64 A 9 9 0 1 1 5.64 18.36"
            stroke="var(--text-faint)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {/* Inner groove: the gap flipped, so the two never line up. */}
          <path
            d="M 18.54 18.54 A 5 5 0 1 1 18.54 5.46"
            stroke="var(--gold-dim)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {/* Label centre — the one spot of full gold. */}
          <circle cx="12" cy="12" r="2" fill="var(--gold)" />
        </>
      )}
    </svg>
  );
}
