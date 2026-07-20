import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { ReleaseCard } from "../components/album/ReleaseCard";

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

  const { artist, releases } = data;
  const facts = [artist.type, artist.area, artist.beginDate && `since ${artist.beginDate}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>{artist.name}</h1>
        {facts && <p className="meta">{facts}</p>}
      </header>

      <section>
        <div className="section-label">
          In the catalog ({releases.length})
        </div>
        {releases.length > 0 ? (
          <div className="release-grid">
            {releases.map((r) => (
              <ReleaseCard key={r.id} release={r} />
            ))}
          </div>
        ) : (
          <p className="meta">No releases seeded yet.</p>
        )}
      </section>
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
