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
 * Mark box edge, as a multiple of `size`. SETTLED — do not relitigate without
 * reading this through; it was gotten wrong once already.
 *
 * The identity sheet gives 336u mark : 200u cap : 84u gap. The trap is that
 * **336u is the artwork's INK, not the SVG's box.** `Soundlog_Mark_v3.svg` is a
 * 512 viewBox whose content bbox is ~340u tall — ink fills only 66.4% of the
 * box height, the rest being the whitespace the mark is drawn with. Sizing the
 * *box* to 1.68× cap therefore renders the *ink* at 1.68 × 0.664 = 1.12× cap,
 * a third smaller than the sheet asks for, while looking arithmetically correct
 * in the code. The first pass here shipped 1.4 for exactly that reason.
 *
 * Solving for the box instead:
 *
 *   cap    = 0.687 × size          (Archivo 800, measured against the loaded
 *                                   face via canvas TextMetrics — not assumed;
 *                                   `size` is the FONT SIZE, not the cap height)
 *   box    = 1.68 × cap / 0.664    (sheet ratio, corrected for the ink inset)
 *          = 1.75 × size           → 35px at the nav's size={20}
 *
 * Gap follows the same correction: 84u/336u = 0.25 of the INK height, so
 * 0.25 × (35 × 0.664) ≈ 6px, which is `gap: 0.3em` in theme.css — NOT the 0.25
 * of the box that the ratio reads like at a glance.
 *
 * Expressed as a multiple rather than a hardcoded 35 so display lockups
 * (`size={32}` and up) keep the same mark-to-letterform relationship instead of
 * silently shrinking the mark as the type grows.
 */
const MARK_SCALE = 1.75;

/**
 * The Soundlog wordmark — the only place the mark is drawn.
 *
 * One treatment: the v3 eighth-note/L mark leading Struck letterforms. Tight
 * Archivo caps, SOUND in `--text` and LOG in `--gold`, and a hairline gold rule
 * inset beneath.
 *
 * The mark is an <img> pointing at the shipped SVG, NOT inline SVG, and that is
 * deliberate. The brand guardrail is that the mark is never recoloured and never
 * redrawn. Inlining would put the artwork in JSX where a call site could reach
 * it with a `currentColor` or a CSS filter; referencing the file makes "as
 * shipped" the only thing that can happen. It also means the mark is one
 * cacheable request shared with the favicon ladder rather than markup
 * re-serialized into every HTML response.
 *
 * ## Why this points at the FLAT build and not the gloss one
 *
 * `Soundlog_Mark_v3.svg` is a gloss rendition, and it draws the glyph by
 * painting gradient-filled rects THROUGH `clipPath#mc` — the shape exists only
 * as a clip. Safari intermittently painted before that reference resolved, and
 * an unresolvable `clip-path` renders unclipped, so the nav showed a solid gold
 * gradient TILE instead of the mark. Intermittent, byte-identical responses,
 * correct on the next repaint.
 *
 * The defect is not the race, which we cannot fix. It is that the gloss build
 * makes the glyph's EXISTENCE depend on a resolvable reference, so a resolution
 * hiccup costs the whole shape rather than the sheen. `_Flat.svg` is the same
 * geometry with a flat `--gold` fill and no clipPath, mask, filter or gradient —
 * nothing to resolve, so the failure mode is unreachable by construction.
 *
 * Sizing is unaffected: the flat build carries the identical path data and the
 * same `translate(-37.6 -6)`, so the ink bbox MARK_SCALE is derived from is
 * unchanged.
 *
 * The gloss build stays everywhere the emboss actually reads — og.png, the app
 * icons, the favicon ladder. At 35px the sheen is imperceptible and the
 * guarantee is worth more.
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
        src="/Soundlog_Mark_v3_Flat.svg"
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
