interface Props {
  /**
   * Font size of the letterforms, in px. The nav uses 20; display lockups are
   * 32 and up.
   *
   * NOT the cap height, despite what this prop was previously documented as.
   * Archivo 800 renders caps at 0.687 of its font size (measured against the
   * loaded face, not assumed), so `size={20}` is a 13.7px cap. The mark scales
   * off this number, so the distinction matters — see MARK_SCALE.
   */
  size?: number;
  /**
   * Draw the hairline gold rule beneath the letterforms. Defaults by size —
   * see below — so call sites don't have to remember the policy.
   */
  rule?: boolean;
}

/** Below this the rule fights the surrounding chrome; above it, it earns its keep. */
const RULE_MIN_SIZE = 32;

/**
 * Mark box edge, as a multiple of `size`.
 *
 * The identity sheet specifies the mark against CAP HEIGHT (336u mark to 200u
 * cap), and the brand phase pinned the nav at a 28px mark. Archivo's measured
 * cap ratio is 0.687, so the nav's cap is 13.7px — under the ~16px threshold
 * where the sheet's ratio would have required scaling up, which is why 28 is
 * used as given rather than derived. 28/20 is the 1.4 here.
 *
 * Expressed as a multiple rather than a hardcoded 28 so display lockups
 * (`size={32}` and up) keep the same mark-to-letterform relationship instead of
 * silently shrinking the mark as the type grows.
 */
const MARK_SCALE = 1.4;

/**
 * The Soundlog wordmark — the only place the mark is drawn.
 *
 * One treatment: the v3 eighth-note/L mark leading Struck letterforms. Tight
 * Archivo caps, SOUND in `--text` and LOG in `--gold`, and a hairline gold rule
 * inset beneath.
 *
 * The mark is an <img> pointing at the shipped SVG, NOT inline SVG, and that is
 * deliberate. The artwork is a gloss rendition — an eight-stop gradient plus a
 * specular overlay — and the brand guardrail is that it is never recoloured and
 * never redrawn. Inlining it would put those stops in JSX where a call site
 * could reach them with a `currentColor` or a CSS filter; referencing the file
 * makes "as shipped" the only thing that can happen. It also means the mark is
 * one cacheable request shared with the favicon ladder rather than markup
 * re-serialized into every HTML response.
 *
 * The rule is size-dependent, not a per-call-site choice. At nav scale it sits
 * within ~20px of the nav's own bottom border and the two read as a mistake;
 * it is also a single physical pixel there, so it softens on non-retina. At
 * display sizes it reads clearly and rhymes with the mark's own horizontal bar.
 * Encoding that as a default keeps the two from drifting apart as call sites
 * multiply; pass `rule` explicitly to override.
 */
export function Wordmark({ size = 20, rule = size >= RULE_MIN_SIZE }: Props) {
  const mark = Math.round(size * MARK_SCALE);

  return (
    <span className={`wordmark${rule ? " wordmark-ruled" : ""}`} style={{ fontSize: size }}>
      {/*
        Empty alt AND aria-hidden: the wordmark text beside it is the accessible
        name, and in the nav the anchor wrapping both carries its own label. A
        described mark here would make the link announce its name twice.

        width/height are attributes, not just CSS, so the 28px box is reserved
        before the SVG arrives and the letterforms don't jump on first paint.
      */}
      <img
        className="wordmark-glyph"
        src="/Soundlog_Mark_v3.svg"
        alt=""
        aria-hidden="true"
        width={mark}
        height={mark}
      />
      <span className="wordmark-text">
        Sound<em>log</em>
      </span>
    </span>
  );
}
