/**
 * Retry a supertest request when the TRANSPORT fails — never when the server
 * answers.
 *
 * ## Why this exists, and why it is narrow
 *
 * `request(app)` spins up a fresh ephemeral server per call and closes it once
 * the response is read. A test that fires several requests back to back can have
 * a new connection land on a port the previous server is still tearing down;
 * macOS answers that with an RST, which surfaces as `Error: socket hang up`. It
 * is load-dependent — `meProfile.test.ts`'s traversal case failed once inside a
 * 270-second full-suite run and passed 6/6 in isolation.
 *
 * The danger of a helper like this is that it becomes a way to make real
 * failures go away. So it is deliberately unable to do that:
 *
 *  - It retries **only** when no HTTP response was received at all. If the
 *    server answers 500, that is a response, and it is returned unchanged for
 *    the test to assert on.
 *  - It retries once. A genuine problem does not become healthy on attempt two,
 *    and a helper that retries five times is a helper that hides things.
 *  - It logs when it retries, so a flake that becomes frequent is visible as a
 *    trend rather than absorbed silently.
 *
 * The alternative — quarantining the test — would delete a real assertion about
 * path traversal to fix a socket problem, and CLAUDE.md §9 is explicit that an
 * assertion must never be relaxed to make a suite pass. This keeps the
 * assertion exactly as strict as it was.
 */

/** Transport-level failures: the request never got an HTTP response. */
const TRANSPORT_ERRORS = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EADDRINUSE",
]);

function isTransportError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; response?: unknown };
  // A superagent error carrying a `response` means the server DID answer.
  if (e?.response) return false;
  if (e?.code && TRANSPORT_ERRORS.has(e.code)) return true;
  return typeof e?.message === "string" && /socket hang up|ECONNRESET|EPIPE/i.test(e.message);
}

/**
 * Run a supertest request, retrying once on a transport failure.
 *
 * Usage: `await resilient(() => request(app).get(url))`
 */
export async function resilient<T>(make: () => PromiseLike<T>): Promise<T> {
  try {
    return await make();
  } catch (err) {
    if (!isTransportError(err)) throw err;
    console.warn(`[test] transport failure, retrying once: ${(err as Error).message}`);
    return await make();
  }
}
