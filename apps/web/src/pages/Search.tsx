import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
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

const TABS: { id: SearchTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "releases", label: "Releases" },
  { id: "artists", label: "Artists" },
  { id: "members", label: "Members" },
  { id: "lists", label: "Lists" },
  { id: "labels", label: "Labels" },
];

export default function Search() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const debouncedQ = useDebounce(q, 300);
  const term = debouncedQ.trim();

  const { data, isFetching, isError } = useQuery({
    queryKey: ["catalog-search", tab, term],
    queryFn: () => api.search(term, tab),
    enabled: term.length > 1,
    staleTime: 60_000,
    retry: false, // search-as-you-type: fail fast, the next keystroke re-queries
    // Keep showing the previous results while the next query loads, so the grid
    // never unmounts under the cursor — clicks always land.
    placeholderData: keepPreviousData,
  });

  const results = data?.results ?? [];
  const artists = data?.artists ?? [];
  const members = data?.members ?? [];
  const lists = data?.lists ?? [];
  const labels = data?.labels ?? [];
  const total = results.length + artists.length + members.length + lists.length + labels.length;
  // Only "empty" once the request actually succeeded.
  const showEmpty = !!data && !isFetching && total === 0;

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

      <div role="tablist" aria-label="Search category" className="tab-row">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {term.length <= 1 && <p className="meta">Type at least two characters to search.</p>}
      {isFetching && <p className="meta">Searching…</p>}
      {isError && <p className="meta">Search is unavailable right now.</p>}
      {showEmpty && <p className="meta">Nothing found for “{term}”.</p>}

      {showArtists && artists.length > 0 && (
        <section>
          <div className="section-label">Artists</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {artists.map((a) => (
              <ArtistResultRow key={a.id} artist={a} />
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
  );
}

function ArtistResultRow({ artist }: { artist: ArtistSearchResult }) {
  const facts = [artist.type, artist.area].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/artist/${artist.id}`}
      className="card-link card"
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: 12 }}
    >
      <strong style={{ fontSize: 15 }}>{artist.name}</strong>
      {facts && <span className="meta">{facts}</span>}
      <span className="meta" style={{ marginLeft: "auto" }}>
        {artist.releaseCount} {artist.releaseCount === 1 ? "release" : "releases"}
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
  return (
    <div>
      <Link to={`/release/${encodeURIComponent(result.ref)}`} className="card-link">
        <CoverImage src={result.coverUrl} alt={`${result.title} cover`} />
        <strong style={{ fontSize: 14, lineHeight: 1.3, display: "block", marginTop: 8 }}>
          {result.title}
        </strong>
      </Link>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        {result.artistId ? (
          <Link to={`/artist/${result.artistId}`} className="artist-link meta">
            {result.artistName}
          </Link>
        ) : (
          <span className="meta">{result.artistName}</span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="type-badge">{RELEASE_TYPE_LABELS[result.type]}</span>
          {result.year && <span className="meta">{result.year}</span>}
        </div>
      </div>
    </div>
  );
}
