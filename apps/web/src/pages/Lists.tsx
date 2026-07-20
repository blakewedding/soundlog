import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";

export default function Lists() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [isRanked, setIsRanked] = useState(true);

  const { data, isLoading } = useQuery({ queryKey: ["lists"], queryFn: () => api.lists() });
  const lists = data?.lists ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { list } = await api.createList({ title, isRanked });
    queryClient.invalidateQueries({ queryKey: ["lists"] });
    navigate(`/list/${list.id}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Lists</h1>
        {user && (
          <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
            {creating ? "Cancel" : "New list"}
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="List title — e.g. Best DJ mixes of the 90s"
            required
            maxLength={120}
            autoFocus
          />
          <label className="meta" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={isRanked} onChange={(e) => setIsRanked(e.target.checked)} style={{ width: "auto" }} />
            Ranked
          </label>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
            Create
          </button>
        </form>
      )}

      {isLoading && <p className="meta">Loading lists…</p>}
      {!isLoading && lists.length === 0 && (
        <p className="meta">No lists yet{user ? " — start the first one." : ". Log in to make one."}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {lists.map((l) => (
          <Link key={l.id} to={`/list/${l.id}`} className="card-link card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{l.title}</strong>
              <div className="meta">
                {l.isRanked ? "Ranked · " : ""}
                {l.itemCount ?? 0} releases · by {l.user?.displayName ?? l.user?.username}
              </div>
            </div>
            {!l.isPublic && <span className="type-badge">Private</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
