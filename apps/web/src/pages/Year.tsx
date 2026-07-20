import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { ChartList } from "../components/album/ChartList";

export default function Year() {
  const { year = "" } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["year-chart", year],
    queryFn: () => api.yearChart(year),
    enabled: year.length > 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header>
        <div className="section-label">Year</div>
        <h1 style={{ marginBottom: 4 }}>{year}</h1>
        <p className="meta">Top releases of {year}, ranked by weighted rating.</p>
      </header>

      {isLoading && <p className="meta">Loading chart…</p>}
      {isError && <p className="meta">We couldn't load that chart.</p>}
      {data && data.releases.length === 0 && (
        <p className="meta">
          Nothing from {year} in the catalog yet. <Link to="/search">Search →</Link>
        </p>
      )}
      {data && data.releases.length > 0 && <ChartList entries={data.releases} />}
    </div>
  );
}
