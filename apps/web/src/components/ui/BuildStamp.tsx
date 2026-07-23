/**
 * The commit the running bundle was built from, in the corner of every dev page.
 *
 * Why this exists: a device kept reproducing a star-input bug that two
 * real-browser verifications reported as fixed. "Is the phone running this
 * code?" was assumed rather than checked, twice. It is cheap to make that
 * answerable by eye, and expensive not to.
 *
 * Read it against `git rev-parse --short HEAD` on the machine serving the app.
 * A mismatch — or a stale timestamp — means the browser is on a cached bundle
 * and nothing else about the report can be trusted yet. `+dirty` means the
 * working tree had uncommitted changes when the dev server started, so the hash
 * alone does not identify what is running.
 *
 * Never rendered in a production build: `import.meta.env.DEV` is a build-time
 * constant, so this is dead-code eliminated rather than merely hidden.
 */
export function BuildStamp() {
  if (!import.meta.env.DEV) return null;

  // Minutes are enough to spot a bundle that predates the last server restart.
  const time = __BUILD_TIME__.slice(11, 16);

  return (
    <div
      // aria-hidden: diagnostic furniture, not content — it should not appear
      // in the accessibility tree or be reachable while tabbing.
      aria-hidden
      style={{
        position: "fixed",
        right: 4,
        bottom: 4,
        zIndex: 9999,
        pointerEvents: "none",
        font: "10px/1.4 ui-monospace, monospace",
        color: "var(--text-faint)",
        background: "rgba(10,10,12,0.82)",
        border: "1px solid var(--line)",
        borderRadius: 3,
        padding: "2px 5px",
        letterSpacing: "0.04em",
      }}
    >
      {__BUILD_STAMP__} · {time}
    </div>
  );
}
