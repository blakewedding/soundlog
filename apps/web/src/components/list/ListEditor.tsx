import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ListDTO } from "../../services/api";
import { patchListEverywhere, removeItem, reorderItems } from "../../lib/listCache";
import { CoverImage } from "../ui/CoverImage";

type ListItemDTO = NonNullable<ListDTO["items"]>[number];

interface Props {
  list: ListDTO; // must include items
  editable: boolean;
  onChanged: () => void;
}

/**
 * Ranked-list editor: reorder with up/down controls, remove items, toggle
 * ranked/public, edit title/description. Ordering is committed as a complete
 * permutation (the API validates it).
 *
 * Every mutation here follows CLAUDE.md §6 — optimistic, rolled back visibly on
 * failure, and patched across every cached surface. Previously each of these
 * was a bare `await` with no `catch`: a failed reorder became an unhandled
 * rejection, the row stayed put, and nothing told you the write had been lost.
 */
export function ListEditor({ list, editable, onChanged }: Props) {
  const queryClient = useQueryClient();
  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [description, setDescription] = useState(list.description ?? "");
  const items = list.items ?? [];

  /**
   * One mutation shape for every list edit: snapshot, patch optimistically,
   * restore the snapshot on failure, reconcile on settle. `apply` returns the
   * optimistic patch; `call` performs the write.
   */
  function listMutation<TVars>(
    call: (vars: TVars) => Promise<unknown>,
    apply: (vars: TVars) => Partial<ListDTO>
  ) {
    return {
      mutationFn: call,
      onMutate: (vars: TVars) => {
        const snapshot: Partial<ListDTO> = {
          title: list.title,
          description: list.description,
          isRanked: list.isRanked,
          isPublic: list.isPublic,
          items: list.items,
        };
        patchListEverywhere(queryClient, list.id, apply(vars));
        return { snapshot };
      },
      onError: (_err: unknown, _vars: TVars, ctx: { snapshot: Partial<ListDTO> } | undefined) => {
        if (ctx) patchListEverywhere(queryClient, list.id, ctx.snapshot);
      },
      onSettled: () => onChanged(),
    };
  }

  const reorder = useMutation(
    listMutation<{ index: number; delta: -1 | 1 }>(
      ({ index, delta }) => {
        const next = reorderItems(items, index, delta);
        return api.reorderList(list.id, next.map((i) => i.releaseId));
      },
      ({ index, delta }) => ({ items: reorderItems(items, index, delta) })
    )
  );

  const remove = useMutation(
    listMutation<string>(
      (releaseId) => api.removeListItem(list.id, releaseId),
      (releaseId) => ({ items: removeItem(items, releaseId) })
    )
  );

  const saveMeta = useMutation(
    listMutation<{ title: string; description: string }>(
      (body) => api.updateList(list.id, body),
      (body) => body
    )
  );

  const toggle = useMutation(
    listMutation<"isRanked" | "isPublic">(
      (field) => api.updateList(list.id, { [field]: !list[field] }),
      (field) => ({ [field]: !list[field] })
    )
  );

  const failed = [reorder, remove, saveMeta, toggle].find((m) => m.isError);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {failed && (
        <div role="alert" className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 10 }}>
          <span className="meta" style={{ color: "var(--danger)" }}>
            That change didn't save — the list has been put back.
          </span>
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 10px", fontSize: 12 }}
            onClick={() => failed.reset()}
          >
            Dismiss
          </button>
        </div>
      )}

      {editingMeta ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMeta.mutate({ title, description });
            setEditingMeta(false);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} aria-label="List title" />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this list about?"
            aria-label="List description"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary">Save</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditingMeta(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div>
          <h1 style={{ marginBottom: 4 }}>{list.title}</h1>
          {list.description && <p style={{ color: "var(--text-muted)" }}>{list.description}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            {list.isRanked && <span className="type-badge">Ranked</span>}
            {!list.isPublic && <span className="type-badge">Private</span>}
            {list.user && <span className="meta">by {list.user.displayName ?? list.user.username}</span>}
            {editable && (
              <>
                <button className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => setEditingMeta(true)}>
                  Edit
                </button>
                <button className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggle.mutate("isRanked")}>
                  {list.isRanked ? "Unrank" : "Make ranked"}
                </button>
                <button className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggle.mutate("isPublic")}>
                  {list.isPublic ? "Make private" : "Make public"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <p className="meta">
          Empty so far — add releases from their pages, or <Link to="/search">find something</Link>.
        </p>
      )}

      <ol style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item, index) => (
          <li key={item.releaseId} className="card list-row" style={{ display: "flex", gap: 12, alignItems: "center", padding: 10 }}>
            {list.isRanked && (
              <span className="stars" style={{ fontSize: 18, minWidth: 28, textAlign: "right" }}>
                {index + 1}
              </span>
            )}
            <div style={{ width: 48, flexShrink: 0 }}>
              <CoverImage src={item.release.coverUrl} alt={`${item.release.title} cover`} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Link to={`/release/${item.releaseId}`} className="card-link">
                <strong style={{ fontSize: 14 }}>{item.release.title}</strong>
              </Link>
              <div className="meta">
                {item.release.artistName}
                {item.release.year ? ` · ${item.release.year}` : ""}
              </div>
              <ItemNote listId={list.id} item={item} editable={editable} onChanged={onChanged} />
            </div>
            {editable && (
              <div className="list-row-controls" style={{ display: "flex", gap: 4 }}>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "2px 8px" }}
                  aria-label={`Move ${item.release.title} up`}
                  disabled={index === 0}
                  onClick={() => reorder.mutate({ index, delta: -1 })}
                >
                  ↑
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "2px 8px" }}
                  aria-label={`Move ${item.release.title} down`}
                  disabled={index === items.length - 1}
                  onClick={() => reorder.mutate({ index, delta: 1 })}
                >
                  ↓
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "2px 8px" }}
                  aria-label={`Remove ${item.release.title}`}
                  onClick={() => remove.mutate(item.releaseId)}
                >
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Per-item note: shown always, editable inline by the owner (empty clears it). */
function ItemNote({
  listId,
  item,
  editable,
  onChanged,
}: {
  listId: string;
  item: ListItemDTO;
  editable: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note ?? "");

  const save = useMutation({
    mutationFn: (note: string | null) => api.updateListItemNote(listId, item.releaseId, note),
    onMutate: (note) => {
      const prev = item.note ?? null;
      patchListEverywhere(queryClient, listId, (l) => ({
        items: (l.items ?? []).map((i) => (i.releaseId === item.releaseId ? { ...i, note } : i)),
      }));
      return { prev };
    },
    onError: (_err, _note, ctx) => {
      patchListEverywhere(queryClient, listId, (l) => ({
        items: (l.items ?? []).map((i) =>
          i.releaseId === item.releaseId ? { ...i, note: ctx?.prev ?? null } : i
        ),
      }));
    },
    onSettled: () => onChanged(),
  });

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(draft.trim() || null);
          setEditing(false);
        }}
        style={{ display: "flex", gap: 6, marginTop: 4 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          aria-label="Item note"
          maxLength={1000}
          style={{ fontSize: 12, padding: "4px 8px" }}
        />
        <button type="submit" className="btn btn-primary" style={{ padding: "2px 10px", fontSize: 12 }}>
          Save
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "2px 10px", fontSize: 12 }}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {item.note && <span className="meta" style={{ fontStyle: "italic" }}>{item.note}</span>}
      {save.isError && (
        <span role="alert" className="meta" style={{ color: "var(--danger)", fontSize: 11 }}>
          Note didn't save
        </span>
      )}
      {editable && (
        <button
          className="btn btn-ghost"
          style={{ padding: "0 8px", fontSize: 11 }}
          onClick={() => {
            setDraft(item.note ?? "");
            setEditing(true);
          }}
        >
          {item.note ? "Edit note" : "Add note"}
        </button>
      )}
    </div>
  );
}
