import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { ReleaseCard } from "../components/album/ReleaseCard";

export default function Label() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["label", id],
    queryFn: () => api.getLabel(id),
    enabled: id.length > 0,
  });

  if (isLoading) return <LabelSkeleton />;
  if (isError || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="meta">We couldn't load that label.</p>
        <Link to="/search">← Back to search</Link>
      </div>
    );
  }

  const { label, releases } = data;
  const facts = [label.area, label.founded && `since ${label.founded}`].filter(Boolean).join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>{label.name}</h1>
        {facts && <p className="meta">{facts}</p>}
      </header>

      <section>
        <div className="section-label">Releases ({releases.length})</div>
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

function LabelSkeleton() {
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
