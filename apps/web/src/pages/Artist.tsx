import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { artistDisplayName } from "@soundlog/shared";
import { api, ApiError } from "../services/api";
import { DiscographyGroups } from "../components/album/DiscographyGroups";

export default function Artist() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["artist", id],
    queryFn: () => api.getArtist(id),
    enabled: id.length > 0,
  });

  if (isLoading) return <ArtistSkeleton />;
  if (isError || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="meta">We couldn't load that artist.</p>
        <Link to="/search">← Back to search</Link>
      </div>
    );
  }

  const { artist } = data;
  const facts = [artist.type, artist.area, artist.beginDate && `since ${artist.beginDate}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>{artistDisplayName(artist)}</h1>
        {facts && <p className="meta">{facts}</p>}
      </header>

      <Discography artistId={id} />
    </div>
  );
}

/**
 * The artist's full observable discography from MusicBrainz, merged with our
 * catalog. The first-ever fetch for a prolific artist costs several sequential
 * (throttled) MusicBrainz calls, so the endpoint answers 202 with progress and
 * we poll — showing how far along it is rather than spinning silently.
 */
function Discography({ artistId }: { artistId: string }) {
  const queryClient = useQueryClient();
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["discography", artistId],
    queryFn: () => api.artistDiscography(artistId),
    enabled: artistId.length > 0,
    // Poll only while MusicBrainz is still being walked.
    refetchInterval: (query) => (query.state.data?.status === "assembling" ? 1200 : false),
    retry: false,
  });

  async function refresh() {
    setRefreshNote(null);
    setRefreshing(true);
    try {
      await api.refreshDiscography(artistId);
      // Cache is busted server-side; re-poll to watch it re-assemble.
      await queryClient.invalidateQueries({ queryKey: ["discography", artistId] });
      setRefreshNote("Re-pulling from MusicBrainz…");
    } catch (err) {
      // 429 carries a human message about when they can try again.
      setRefreshNote(err instanceof ApiError ? err.message : "Couldn't refresh right now.");
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) return <p className="meta">Loading discography…</p>;

  if (isError) {
    const busy = error instanceof ApiError && error.status === 503;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p className="meta">
          {busy
            ? "MusicBrainz is busy right now — the discography couldn't be assembled."
            : "We couldn't load this discography."}
        </p>
        <button
          className="btn btn-ghost"
          style={{ alignSelf: "flex-start" }}
          onClick={() => queryClient.invalidateQueries({ queryKey: ["discography", artistId] })}
        >
          Try again
        </button>
      </div>
    );
  }

  if (data?.status === "assembling") {
    const { fetched, total } = data.progress;
    const pct = total ? Math.min(100, Math.round((fetched / total) * 100)) : null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="section-label">Discography</div>
        <p className="meta">
          Fetching from MusicBrainz — {fetched}
          {total ? ` of ${total}` : ""} releases so far
          {pct !== null ? ` (${pct}%)` : ""}. Prolific artists take a few seconds.
        </p>
        <div className="progress-track" aria-hidden>
          <div
            className={pct === null ? "progress-bar progress-indeterminate" : "progress-bar"}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (data.unavailable) {
    return <p className="meta">{data.unavailable}</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Discography</h2>
        <span className="meta">
          {data.counts.total} releases · {data.counts.seeded} in catalog
        </span>
        <button
          className="btn btn-ghost"
          style={{ marginLeft: "auto", fontSize: 12, padding: "2px 10px" }}
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh discography"}
        </button>
      </div>
      {refreshNote && <p className="meta">{refreshNote}</p>}

      {data.groups.length > 0 ? (
        <DiscographyGroups groups={data.groups} />
      ) : (
        <p className="meta">MusicBrainz lists no releases for this artist.</p>
      )}
    </div>
  );
}

function ArtistSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }} aria-busy="true">
      <div>
        <div className="skeleton" style={{ height: 36, width: "40%", marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 14, width: "25%" }} />
      </div>
      <div className="release-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ aspectRatio: "1" }} />
        ))}
      </div>
    </div>
  );
}
