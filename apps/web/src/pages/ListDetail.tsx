import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { ListEditor } from "../components/list/ListEditor";

export default function ListDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["list", id],
    queryFn: () => api.getList(id),
    enabled: id.length > 0,
  });

  if (isLoading) return <p className="meta">Loading list…</p>;
  if (isError || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="meta">We couldn't load that list.</p>
        <Link to="/lists">← All lists</Link>
      </div>
    );
  }

  const list = data.list;
  const editable = !!user && list.user?.id === user.id;

  async function destroy() {
    await api.deleteList(list.id);
    queryClient.invalidateQueries({ queryKey: ["lists"] });
    navigate("/lists");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <ListEditor
        list={list}
        editable={editable}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["list", id] });
          // Title/ranked/item-count changes surface on the list index too.
          queryClient.invalidateQueries({ queryKey: ["lists"] });
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Link to="/lists" className="meta">
          ← All lists
        </Link>
        {editable && (
          <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={destroy}>
            Delete list
          </button>
        )}
      </div>
    </div>
  );
}
