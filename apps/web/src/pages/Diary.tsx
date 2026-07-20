import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type DiaryEntry } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { StarRating } from "../components/ui/StarRating";
import { CoverImage } from "../components/ui/CoverImage";

/** Reverse-chronological listen diary, grouped by month, with cursor paging. */
export default function Diary() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  // Accumulated extra pages beyond the first (which the query owns), so a fresh
  // log invalidation still refetches page one cleanly.
  const [extra, setExtra] = useState<DiaryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ["diary"],
    queryFn: () => api.myDiary(),
    enabled: !!user,
  });

  const logs = useMemo(() => [...(data?.logs ?? []), ...extra], [data, extra]);
  const groups = useMemo(() => groupByMonth(logs), [logs]);
  const nextCursor = cursor !== undefined ? cursor : data?.nextCursor ?? null;

  if (loading) return <p className="meta">Loading…</p>;
  if (!user) {
    return (
      <p className="meta">
        <Link to="/login">Log in</Link> to see your listening diary.
      </p>
    );
  }
  if (isLoading) return <p className="meta">Loading your diary…</p>;

  const refresh = () => {
    setExtra([]);
    setCursor(undefined);
    queryClient.invalidateQueries({ queryKey: ["diary"] });
  };

  async function loadMore() {
    const page = await api.myDiary(nextCursor ?? undefined);
    setExtra((e) => [...e, ...page.logs]);
    setCursor(page.nextCursor);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <h1>Diary</h1>
      {groups.length === 0 && (
        <p className="meta">
          No listens logged yet — hit “Log listen” on any <Link to="/search">release</Link>.
        </p>
      )}
      {groups.map(({ month, entries }) => (
        <section key={month}>
          <div className="section-label">{month}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entries.map((entry) => (
              <DiaryRow key={entry.id} entry={entry} onChanged={refresh} />
            ))}
          </div>
        </section>
      ))}
      {nextCursor && (
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}

function groupByMonth(logs: DiaryEntry[]): Array<{ month: string; entries: DiaryEntry[] }> {
  const groups: Array<{ month: string; entries: DiaryEntry[] }> = [];
  for (const log of logs) {
    const month = new Date(log.listenedAt).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const last = groups[groups.length - 1];
    if (last?.month === month) last.entries.push(log);
    else groups.push({ month, entries: [log] });
  }
  return groups;
}

function DiaryRow({ entry, onChanged }: { entry: DiaryEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(entry.listenedAt.slice(0, 10));
  const day = new Date(entry.listenedAt).toLocaleDateString(undefined, {
    day: "numeric",
    weekday: "short",
  });

  async function saveDate(e: React.FormEvent) {
    e.preventDefault();
    // Keep the original time of day; only the calendar date is edited.
    const time = entry.listenedAt.slice(10);
    await api.updateLog(entry.id, { listenedAt: `${date}${time}` });
    setEditing(false);
    onChanged();
  }

  async function remove() {
    await api.deleteLog(entry.id);
    onChanged();
  }

  return (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 10 }}>
      <span className="meta" style={{ minWidth: 64 }}>{day}</span>
      <div style={{ width: 48, flexShrink: 0 }}>
        <CoverImage src={entry.release.coverUrl} alt={`${entry.release.title} cover`} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link to={`/release/${entry.release.id}`} className="card-link">
          <strong style={{ fontSize: 14 }}>{entry.release.title}</strong>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="meta">{entry.release.artistName}</span>
          {entry.isRelisten && <span className="type-badge">Relisten</span>}
          {entry.myRating != null && <StarRating value={entry.myRating} />}
        </div>
      </div>
      {editing ? (
        <form onSubmit={saveDate} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Listen date"
            style={{ width: 150 }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: "4px 10px" }}>
            Save
          </button>
          <button type="button" className="btn btn-ghost" style={{ padding: "4px 10px" }} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setEditing(true)}>
            Edit date
          </button>
          <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} aria-label="Delete entry" onClick={remove}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
