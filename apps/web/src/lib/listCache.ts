import type { QueryClient } from "@tanstack/react-query";
import type { ListDTO } from "../services/api";

// The fourth sibling of reviewCache / releaseCache / followCache. A list shows
// up on its own page, the list index, and a profile's Lists tab, and its
// title / ranked flag / item count render on all three. Reordering and removing
// items previously round-tripped before anything moved on screen, which on a
// throttled connection made the arrows feel broken and invited double-clicks —
// each of which committed a *different* permutation.

type ListPatch = Partial<ListDTO> | ((l: ListDTO) => Partial<ListDTO>);

function applyPatch(l: ListDTO, patch: ListPatch): ListDTO {
  const delta = typeof patch === "function" ? patch(l) : patch;
  return { ...l, ...delta };
}

/**
 * Return a new copy of a query's data with the matching list patched, or the
 * SAME reference when nothing changed. Handles the two container shapes:
 *   { list }           — the list detail page
 *   { lists: [...] }   — the list index and a profile's Lists tab
 */
export function patchListInData(data: unknown, listId: string, patch: ListPatch): unknown {
  if (!data || typeof data !== "object") return data;

  const obj = data as { list?: ListDTO | null; lists?: ListDTO[] };

  if (obj.list && obj.list.id === listId) {
    return { ...obj, list: applyPatch(obj.list, patch) };
  }

  if (Array.isArray(obj.lists)) {
    let changed = false;
    const lists = obj.lists.map((l) => {
      if (l?.id !== listId) return l;
      changed = true;
      return applyPatch(l, patch);
    });
    return changed ? { ...obj, lists } : data;
  }

  return data;
}

/** Patch a list across every cached query that contains it. */
export function patchListEverywhere(qc: QueryClient, listId: string, patch: ListPatch): void {
  qc.setQueriesData({}, (old) => patchListInData(old, listId, patch));
}

type ListItems = NonNullable<ListDTO["items"]>;

/**
 * Move an item and renumber. `position` is what the server persists and what
 * the ranked view renders, so it has to be rewritten locally too — otherwise
 * the optimistic order is right but the displayed ranks are stale.
 * Returns the same array reference when the move is a no-op.
 */
export function reorderItems(items: ListItems, index: number, delta: -1 | 1): ListItems {
  const target = index + delta;
  if (index < 0 || target < 0 || index >= items.length || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, i) => ({ ...item, position: i }));
}

/** Drop an item and close the gap in `position`. */
export function removeItem(items: ListItems, releaseId: string): ListItems {
  const next = items.filter((i) => i.releaseId !== releaseId);
  if (next.length === items.length) return items;
  return next.map((item, i) => ({ ...item, position: i }));
}
