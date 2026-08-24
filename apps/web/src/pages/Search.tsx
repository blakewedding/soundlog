import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ApiError } from "../services/api";
import { RELEASE_TYPE_LABELS, artistDisplayName } from "@soundlog/shared";
import type {
  ArtistSearchResult,
  CatalogSearchResult,
  MemberSearchResult,
  ListSearchResult,
  LabelSearchResult,
  SearchTab,
} from "@soundlog/shared";
import { api } from "../services/api";
import { useDebounce } from "../hooks/useDebounce";
import { CoverImage } from "../components/ui/CoverImage";
import { ArtistCredit } from "../components/album/ArtistCredit";
import { usePrefetchRelease } from "../hooks/usePrefetchRelease";

const TABS: { id: SearchTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "releases", label: "Releases" },
  { id: "artists", label: "Artists" },
  { id: "members", label: "Members" },
  { id: "lists", label: "Lists" },
  { id: "labels", label: "Labels" },
];

export default function Search() {
  // Seeded from the URL so an artist-credit link like /search?q=Joy%20Division
  // lands on real results (and searches stay shareable).
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [tab, setTab] = useState<SearchTab>("all");
  const debouncedQ = useDebounce(q, 300);
  const term = debouncedQ.trim();
  const tabRefs = useRef<Partial<Record<SearchTab, HTMLButtonElement | null>>>({});

  /**
   * Left/Right move between tabs (wrapping), Home/End jump to the ends —
   * the standard tablist keys. Selection follows focus, which is the correct
   * variant here because switching tabs only filters an already-loaded result
   * set, so there is no expensive work to defer behind an explicit Enter.
   */
  function onTabKeyDown(e: React.KeyboardEvent) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();

    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length
      : (i + 1) % TABS.length;

    const id = TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  const { data, isFetching, isError, error, refetch, failureCount, failureReason } = useQuery({
    queryKey: ["catalog-search", tab, term],
    queryFn: () => api.search(term, tab),
    enabled: term.length > 1,
    staleTime: 60_000,
    /**
     * Retry ONLY an upstream-busy 503, and only twice.
     *
     * Before 6.3e this was `retry: false` with a one-line "search is
     * unavailable" — which was fine when the server never sent a 503 for this,
     * because it answered an outage with an empty 200 instead. Now that a
     * failure is honestly a failure, the client has to be honest back: a
     * transient upstream is worth waiting out, and everything else (a 4xx, a
     * bug) is not, because retrying it just fails again more slowly.
     *
     * Still fail-fast for search-as-you-type: two attempts, and any keystroke
     * changes the query key and abandons them.
     */
    retry: (count, err) => err instanceof ApiError && err.isUpstreamBusy && count < 2,
    /**
     * Wait as long as the SERVER asked, not as long as we guessed.
     *
     * `errorHandler` sends `Retry-After` on every `UpstreamUnavailableError`;
     * ignoring it and inventing our own schedule is how a client turns one
     * upstream's bad minute into a retry storm — the same §7 reasoning that
     * governs how hard the backend retries, applied one layer out.
     */
    retryDelay: (count, err) => {
      const asked = err instanceof ApiError ? err.retryAfterSeconds : undefined;
      return asked !== undefined ? asked * 1000 : Math.min(1000 * 2 ** count, 8000);
    },
    // Keep showing the previous results while the next query loads, so the grid
    // never unmounts under the cursor — clicks always land.
    placeholderData: keepPreviousData,
  });

  /**
   * The three outcomes, at the surface (§1).
   *
   * `degraded` and `showEmpty` must never be the same rendering. That identity
   * is the entire 6.3e bug: an unreachable MusicBrainz and a genuinely unknown
   * artist produced the same empty list, so "we could not tell" was displayed as
   * "there is nothing". The law is only kept if the distinction survives all the
   * way to what a person reads.
   */
  //
  // `failureReason`, not just `error`. With retries enabled, react-query keeps
  // `isError` false until the LAST attempt fails — so a 503 being patiently
  // retried on the server's schedule would show "Searching…" for several
  // seconds while we already knew perfectly well that upstream was busy. That
  // is a smaller version of the same sin: withholding a known third outcome
  // because it has not finished being true yet. `failureReason` carries the
  // in-flight failure, and clears on success.
  const failure = (error ?? failureReason) as unknown;
  const degraded = failure instanceof ApiError && failure.isUpstreamBusy;
  const brokenOtherwise = isError && !degraded;

  const results = data?.results ?? [];
  const artists = data?.artists ?? [];
  const members = data?.members ?? [];
  const lists = data?.lists ?? [];
  const labels = data?.labels ?? [];
  const total = results.length + artists.length + members.length + lists.length + labels.length;
  // Only "empty" once the request actually SUCCEEDED — never on an error, and
  // never while a retry is still outstanding.
  const showEmpty = !!data && !isFetching && !isError && total === 0;

  const showReleases = tab === "all" || tab === "releases";
  const showArtists = tab === "all" || tab === "artists";
  const showMembers = tab === "all" || tab === "members";
  const showLists = tab === "all" || tab === "lists";
  const showLabels = tab === "all" || tab === "labels";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Search</h1>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search artists, albums, members, lists, labels…"
        aria-label="Search Soundlog"
        autoFocus
      />

      {/* ARIA tabs pattern. Declaring role="tab" promises keyboard behaviour
          that wasn't implemented: a tablist is ONE tab stop, and Left/Right
          move between tabs. Before this, all six tabs sat in the tab order and
          arrow keys did nothing — a screen-reader user was told to press arrows
          and nothing happened. Roving tabindex + arrow handling below. */}
      <div role="tablist" aria-label="Search category" className="tab-row">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`search-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="search-results"
            tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            className={`tab${tab === t.id ? " tab-active" : ""}`}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The panel the tablist controls. aria-live so a screen reader hears the
          result count change instead of silently re-rendering underneath. */}
      <div
        id="search-results"
        role="tabpanel"
        aria-labelledby={`search-tab-${tab}`}
        tabIndex={-1}
        style={{ display: "flex", flexDirection: "column", gap: 24 }}
      >
      <p className="meta" role="status" aria-live="polite">
        {term.length <= 1
          ? "Type at least two characters to search."
          : degraded
            ? "" /* the banner below owns this message, and owns the alert role */
            : brokenOtherwise
              ? "Search is unavailable right now."
              : isFetching
                ? "Searching…"
                : showEmpty
                  ? `Nothing found for “${term}”.`
                  : total > 0
                    ? `${total} result${total === 1 ? "" : "s"} for “${term}”.`
                    : ""}
      </p>

      {/* The degraded state.
          Deliberately a BANNER and not a line of muted meta text: "nothing
          matched your search" and "we could not ask" are different facts about
          the world, and a person cannot act on the difference if both render as
          the same grey sentence. role="alert" rather than "status" because this
          one is interruptive — it changes what the empty grid below it means.
          Results already on screen are kept (placeholderData), so this reads as
          "this list may be short" rather than replacing good data with an
          error. */}
      {degraded && (
        <div className="notice notice-degraded" role="alert">
          <span>
            The catalog upstream is busy — showing what we already have.
            {failureCount > 0 ? " Retrying…" : ""}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => refetch()}>
            Try now
          </button>
        </div>
      )}

      {showArtists && artists.length > 0 && (
        <section>
          <div className="section-label">Artists</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {artists.map((a) => (
              <ArtistResultRow key={a.ref} artist={a} />
            ))}
          </div>
        </section>
      )}

      {showMembers && members.length > 0 && (
        <section>
          <div className="section-label">Members</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((m) => (
              <MemberResultRow key={m.id} member={m} />
            ))}
          </div>
        </section>
      )}

      {showLists && lists.length > 0 && (
        <section>
          <div className="section-label">Lists</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lists.map((l) => (
              <ListResultRow key={l.id} list={l} />
            ))}
          </div>
        </section>
      )}

      {showLabels && labels.length > 0 && (
        <section>
          <div className="section-label">Labels</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {labels.map((l) => (
              <LabelResultRow key={l.id} label={l} />
            ))}
          </div>
        </section>
      )}

      {showReleases && results.length > 0 && (
        <section>
          <div className="section-label">Releases</div>
          <div className="release-grid" style={isFetching ? { opacity: 0.6 } : undefined}>
            {results.map((r) => (
              <SearchResultCard key={r.ref} result={r} />
            ))}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

function ArtistResultRow({ artist }: { artist: ArtistSearchResult }) {
  const facts = [artist.type, artist.area, artist.disambiguation].filter(Boolean).join(" · ");
  // Null means we hold nothing yet, which is NOT the same as holding zero.
  // "0 releases" reads as an artist we know and have nothing by — a dead end.
  // This is an invitation, and it is the only cue distinguishing a cold artist
  // from an empty one now that search surfaces both (6.2d).
  const cold = artist.releaseCount === null;
  return (
    <Link
      // `ref`, never `id` — a cold artist has no id, and navigating by ref is
      // what materializes them. NOT hover-prefetched: see isPrefetchableRef,
      // which refuses colon-shaped refs precisely because opening one writes.
      to={`/artist/${artist.ref}`}
      className="card-link card"
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: 12 }}
    >
      <strong style={{ fontSize: 15 }}>{artistDisplayName(artist)}</strong>
      {facts && <span className="meta">{facts}</span>}
      <span className="meta" style={{ marginLeft: "auto" }}>
        {cold
          ? "Not in the catalog yet — open to add"
          : `${artist.releaseCount} ${artist.releaseCount === 1 ? "release" : "releases"}`}
      </span>
    </Link>
  );
}

function MemberResultRow({ member }: { member: MemberSearchResult }) {
  return (
    <Link
      to={`/${member.username}`}
      className="card-link card"
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: 12 }}
    >
      <strong style={{ fontSize: 15 }}>{member.displayName ?? member.username}</strong>
      <span className="meta">@{member.username}</span>
    </Link>
  );
}

function ListResultRow({ list }: { list: ListSearchResult }) {
  return (
    <Link
      to={`/list/${list.id}`}
      className="card-link card"
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: 12 }}
    >
      <strong style={{ fontSize: 15 }}>{list.title}</strong>
      <span className="meta">by @{list.username}</span>
      <span className="meta" style={{ marginLeft: "auto" }}>
        {list.itemCount} {list.itemCount === 1 ? "release" : "releases"}
      </span>
    </Link>
  );
}

function LabelResultRow({ label }: { label: LabelSearchResult }) {
  return (
    <Link
      to={`/label/${label.id}`}
      className="card-link card"
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: 12 }}
    >
      <strong style={{ fontSize: 15 }}>{label.name}</strong>
      {label.area && <span className="meta">{label.area}</span>}
      <span className="meta" style={{ marginLeft: "auto" }}>
        {label.releaseCount} {label.releaseCount === 1 ? "release" : "releases"}
      </span>
    </Link>
  );
}

function SearchResultCard({ result }: { result: CatalogSearchResult }) {
  // Unseeded results carry a "<source>:<id>" ref, which the hook refuses to
  // prefetch — hovering a search grid must not seed the catalog.
  const prefetch = usePrefetchRelease();
  return (
    <div>
      <Link
        to={`/release/${encodeURIComponent(result.ref)}`}
        className="card-link"
        onMouseEnter={() => prefetch(result.ref)}
        onFocus={() => prefetch(result.ref)}
      >
        <CoverImage src={result.coverUrl} color={result.coverColor} alt={`${result.title} cover`} />
        <strong style={{ fontSize: 14, lineHeight: 1.3, display: "block", marginTop: 8 }}>
          {result.title}
        </strong>
      </Link>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        <ArtistCredit artistId={result.artistId} artistName={result.artistName} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="type-badge">{RELEASE_TYPE_LABELS[result.type]}</span>
          {result.year && <span className="meta">{result.year}</span>}
        </div>
      </div>
    </div>
  );
}
