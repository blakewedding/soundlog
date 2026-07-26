/**
 * Says out loud that a release is still being filled in — or that filling it in
 * broke.
 *
 * A release seeded on first access is written as a canonical skeleton and
 * enriched behind the response (artist, label, genres, cover art). Production
 * logs show that enrichment misses its budget essentially every time, so the
 * first render of a new release genuinely has no label, no genres and no cover.
 * Until this existed, the page drew that exactly like a finished record: no
 * spinner, no note, nothing to distinguish "we're still working" from "this
 * release has no label". The only thing that ever repaired it was rating the
 * album, because the rating mutation's cache invalidation was the sole refetch
 * trigger on the page.
 *
 * Three states, because two would reintroduce the bug in a quieter form:
 *
 *  - **pending** — still working. The page polls, and this says so.
 *  - **failed** — enrichment finished with a broken stage, or the poll budget
 *    ran out. The data is partial and we know it, so this is an error with a
 *    retry, NOT a spinner that turns forever.
 *  - **ready** — nothing to say. Absences on the page are real absences.
 */

interface Props {
  /** The server's enrichment status for this release. */
  status?: "pending" | "ready" | "failed";
  /** True once the client stopped polling because it ran out of budget. */
  gaveUp: boolean;
  /** Refetch now — the retry affordance a visible failure is required to carry. */
  onRetry: () => void;
  /** True while that retry is in flight, so the button can't be double-fired. */
  retrying: boolean;
  /**
   * Why the retry itself failed, if it did — a rate-limit refusal, say. A retry
   * that silently does nothing is the very shape this component exists to stop,
   * so its own failure has to be visible too.
   */
  error?: string | null;
}

export function EnrichmentNotice({ status, gaveUp, onRetry, retrying, error }: Props) {
  if (status !== "pending" && status !== "failed") return null;

  const stalled = status === "failed" || gaveUp;

  if (!stalled) {
    return (
      // aria-live polite, not assertive: this is progress, and it resolves on
      // its own. A screen reader should hear it without being interrupted.
      <div className="enrich-notice" role="status" aria-live="polite">
        <span className="enrich-spinner" aria-hidden="true" />
        <span className="meta">Still fetching details for this release…</span>
      </div>
    );
  }

  return (
    <div className="enrich-notice enrich-notice-failed" role="alert">
      <span className="meta" style={{ color: "var(--danger)" }}>
        {gaveUp && status === "pending"
          ? "This is taking longer than usual — some details may be missing."
          : "Some details couldn't be loaded."}
      </span>
      <button
        className="btn btn-ghost"
        style={{ padding: "2px 10px", fontSize: 12 }}
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
      {error && (
        <span className="meta" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
