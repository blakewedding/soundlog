import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { ListEditor } from "../components/list/ListEditor";

export default function ListDetail() {
  const { id = "" } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState(false);

  // Wait for the auth bootstrap so a private list is fetched WITH the owner's
  // token. Without this guard, opening a private list URL directly (or simply
  // refreshing the page) raced the token and 404'd — the same fix Profile.tsx
  // already carries. Keyed by viewer so switching accounts refetches.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["list", id, user?.id],
    queryFn: () => api.getList(id),
    enabled: id.length > 0 && !authLoading,
  });

  // While auth bootstraps the query is disabled, and a disabled query reports
  // isLoading:false — so without this the page would fall straight through to
  // the error branch on every load.
  if (authLoading || isLoading) return <p className="meta">Loading list…</p>;
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

  // Deleting navigates away, so there is nothing to update optimistically —
  // but the failure still has to be visible. A bare `await` here made a failed
  // delete an unhandled rejection that simply left you on the page.
  async function destroy() {
    try {
      await api.deleteList(list.id);
    } catch {
      setDeleteError(true);
      return;
    }
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {deleteError && (
              <span role="alert" className="meta" style={{ color: "var(--danger)" }}>
                Couldn't delete that list.
              </span>
            )}
            <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={destroy}>
              Delete list
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
