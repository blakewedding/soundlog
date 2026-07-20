import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { ChartList } from "../components/album/ChartList";

export default function Genre() {
  const { tag = "" } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["genre-chart", tag],
    queryFn: () => api.genreChart(tag),
    enabled: tag.length > 0,
  });

  const title = (data?.tag ?? tag.replace(/-/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header>
        <div className="section-label">Genre</div>
        <h1 style={{ marginBottom: 4 }}>{title}</h1>
        <p className="meta">Top releases, ranked by weighted rating.</p>
      </header>

      {isLoading && <p className="meta">Loading chart…</p>}
      {isError && <p className="meta">We couldn't load that chart.</p>}
      {data && data.releases.length === 0 && (
        <p className="meta">
          Nothing tagged “{title}” yet. <Link to="/search">Search the catalog →</Link>
        </p>
      )}
      {data && data.releases.length > 0 && <ChartList entries={data.releases} />}
    </div>
  );
}
