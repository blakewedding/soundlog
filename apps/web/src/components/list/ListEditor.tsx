import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ListDTO } from "../../services/api";
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
 */
export function ListEditor({ list, editable, onChanged }: Props) {
  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [description, setDescription] = useState(list.description ?? "");
  const items = list.items ?? [];

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const order = items.map((i) => i.releaseId);
    [order[index], order[target]] = [order[target], order[index]];
    await api.reorderList(list.id, order);
    onChanged();
  }

  async function remove(releaseId: string) {
    await api.removeListItem(list.id, releaseId);
    onChanged();
  }

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    await api.updateList(list.id, { title, description });
    setEditingMeta(false);
    onChanged();
  }

  async function toggle(field: "isRanked" | "isPublic") {
    await api.updateList(list.id, { [field]: !list[field] });
    onChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {editingMeta ? (
        <form onSubmit={saveMeta} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this list about?"
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
                <button className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggle("isRanked")}>
                  {list.isRanked ? "Unrank" : "Make ranked"}
                </button>
                <button className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggle("isPublic")}>
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
          <li key={item.releaseId} className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 10 }}>
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
              <div style={{ display: "flex", gap: 4 }}>
                <button className="btn btn-ghost" style={{ padding: "2px 8px" }} aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button className="btn btn-ghost" style={{ padding: "2px 8px" }} aria-label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </button>
                <button className="btn btn-ghost" style={{ padding: "2px 8px" }} aria-label="Remove" onClick={() => remove(item.releaseId)}>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await api.updateListItemNote(listId, item.releaseId, draft.trim() || null);
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <form onSubmit={save} style={{ display: "flex", gap: 6, marginTop: 4 }}>
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
