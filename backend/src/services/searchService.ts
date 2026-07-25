// Elasticsearch layer for the catalog: index writes and the ES-first read path.
// Postgres is the source of truth; the index is rebuildable, so index failures
// are logged, never thrown.
import {
  es,
  RELEASE_INDEX,
  ARTIST_INDEX,
  USER_INDEX,
  LIST_INDEX,
  LABEL_INDEX,
} from "../config/elasticsearch.js";
import type { Artist, Label, Release, ReleaseType, User } from "@prisma/client";

// ES writes/reads are best-effort: Postgres is the source of truth and the index
// is rebuildable, so a failure is logged and swallowed — it must never fail the
// originating request (login, registration, a list edit…). Log with enough
// detail to diagnose an outage: the @elastic/elasticsearch ConnectionError often
// has an EMPTY `.message`, so include the error name and any HTTP status too.
function warnEs(op: string, err: unknown): void {
  const e = err as { name?: string; message?: string; meta?: { statusCode?: number } };
  const detail = [e?.name, e?.message, e?.meta?.statusCode ? `HTTP ${e.meta.statusCode}` : ""]
    .filter(Boolean)
    .join(" — ");
  console.warn(`[es] ${op} failed: ${detail || String(err)}`);
}

export interface EsReleaseHit {
  id: string;
  title: string;
  artistName: string;
  artistId?: string;
  type: ReleaseType;
  year?: string;
  coverUrl?: string;
  coverColor?: string;
}

/** Index (or re-index) a Release. Never throws — a search hiccup mustn't fail a write. */
export async function indexRelease(release: Release): Promise<void> {
  try {
    await es.index({
      index: RELEASE_INDEX,
      id: release.id,
      document: {
        title: release.title,
        artistName: release.artistName,
        artistId: release.artistId ?? undefined,
        type: release.type,
        genres: release.genres,
        releaseDate: release.releaseDate ?? undefined,
        coverUrl: release.coverUrl ?? undefined,
        coverColor: release.coverColor ?? undefined,
      },
    });
  } catch (err) {
    warnEs("indexRelease", err);
  }
}

/**
 * Remove a release document from the index. Unlike indexing, deletion failures
 * are surfaced — silently keeping an orphaned doc means broken search results.
 * A 404 (already gone) is fine.
 */
export async function deindexRelease(releaseId: string): Promise<void> {
  try {
    await es.delete({ index: RELEASE_INDEX, id: releaseId });
  } catch (err) {
    const status = (err as { meta?: { statusCode?: number } }).meta?.statusCode;
    if (status !== 404) throw err;
  }
}

/** Index (or re-index) an Artist. Same failure posture as indexRelease. */
export async function indexArtist(artist: Artist): Promise<void> {
  try {
    await es.index({
      index: ARTIST_INDEX,
      id: artist.id,
      document: {
        name: artist.name,
        latinName: artist.latinName ?? undefined,
        sortName: artist.sortName ?? undefined,
        type: artist.type ?? undefined,
        area: artist.area ?? undefined,
      },
    });
  } catch (err) {
    warnEs("indexArtist", err);
  }
}

interface EsSource {
  title: string;
  artistName: string;
  artistId?: string;
  type: ReleaseType;
  releaseDate?: string;
  coverUrl?: string;
  coverColor?: string;
}

/** Search already-seeded releases in Elasticsearch. Returns [] if ES is down. */
export async function esSearchReleases(q: string, type?: string): Promise<EsReleaseHit[]> {
  try {
    const result = await es.search<EsSource>({
      index: RELEASE_INDEX,
      size: 25,
      query: {
        bool: {
          must: [{ multi_match: { query: q, fields: ["title^2", "artistName"] } }],
          ...(type ? { filter: [{ term: { type } }] } : {}),
        },
      },
    });
    return result.hits.hits.map((h) => {
      const src = h._source as EsSource;
      return {
        id: h._id as string,
        title: src.title,
        artistName: src.artistName,
        artistId: src.artistId,
        type: src.type,
        year: src.releaseDate?.slice(0, 4) || undefined,
        coverUrl: src.coverUrl,
        coverColor: src.coverColor,
      };
    });
  } catch (err) {
    warnEs("release search", err);
    return [];
  }
}

export interface EsArtistHit {
  id: string;
  name: string;
  latinName?: string;
  type?: string;
  area?: string;
}

interface EsArtistSource {
  name: string;
  latinName?: string;
  type?: string;
  area?: string;
}

/** Search seeded artists in Elasticsearch. Returns [] if ES is down. */
export async function esSearchArtists(q: string, size = 5): Promise<EsArtistHit[]> {
  try {
    const result = await es.search<EsArtistSource>({
      index: ARTIST_INDEX,
      size,
      // Match either script: "Fishmans" and "フィッシュマンズ" both find the artist.
      query: {
        multi_match: { query: q, fields: ["name", "latinName"], operator: "and" },
      },
    });
    return result.hits.hits.map((h) => {
      const src = h._source as EsArtistSource;
      return {
        id: h._id as string,
        name: src.name,
        latinName: src.latinName,
        type: src.type,
        area: src.area,
      };
    });
  } catch (err) {
    warnEs("artist search", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Members (users), lists, labels — indexed for the tabbed search (Phase 5).
// ---------------------------------------------------------------------------

export async function indexUser(user: User): Promise<void> {
  try {
    await es.index({
      index: USER_INDEX,
      id: user.id,
      document: { username: user.username, displayName: user.displayName ?? undefined, bio: user.bio ?? undefined },
    });
  } catch (err) {
    warnEs("indexUser", err);
  }
}

export async function indexLabel(label: Label): Promise<void> {
  try {
    await es.index({
      index: LABEL_INDEX,
      id: label.id,
      document: { name: label.name, area: label.area ?? undefined },
    });
  } catch (err) {
    warnEs("indexLabel", err);
  }
}

interface ListDoc {
  title: string;
  description?: string;
  username: string;
  itemCount: number;
}
/** Index a public list; a non-public list is removed from the index instead. */
export async function indexList(list: {
  id: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  username: string;
  itemCount: number;
}): Promise<void> {
  try {
    if (!list.isPublic) {
      await deindexList(list.id);
      return;
    }
    await es.index({
      index: LIST_INDEX,
      id: list.id,
      document: {
        title: list.title,
        description: list.description ?? undefined,
        username: list.username,
        itemCount: list.itemCount,
      } satisfies ListDoc,
    });
  } catch (err) {
    warnEs("indexList", err);
  }
}

async function deindexDoc(index: string, id: string): Promise<void> {
  try {
    await es.delete({ index, id });
  } catch (err) {
    const status = (err as { meta?: { statusCode?: number } }).meta?.statusCode;
    if (status !== 404) warnEs(`deindex ${index}`, err);
  }
}
export const deindexList = (id: string) => deindexDoc(LIST_INDEX, id);
export const deindexUser = (id: string) => deindexDoc(USER_INDEX, id);

export interface EsUserHit {
  id: string;
  username: string;
  displayName?: string;
}
export async function esSearchUsers(q: string, size = 10): Promise<EsUserHit[]> {
  try {
    const result = await es.search<{ username: string; displayName?: string }>({
      index: USER_INDEX,
      size,
      query: { multi_match: { query: q, fields: ["username^2", "displayName", "bio"] } },
    });
    return result.hits.hits.map((h) => {
      const src = h._source as { username: string; displayName?: string };
      return { id: h._id as string, username: src.username, displayName: src.displayName };
    });
  } catch (err) {
    warnEs("user search", err);
    return [];
  }
}

export interface EsListHit {
  id: string;
  title: string;
  username: string;
  itemCount: number;
}
export async function esSearchLists(q: string, size = 10): Promise<EsListHit[]> {
  try {
    const result = await es.search<ListDoc>({
      index: LIST_INDEX,
      size,
      query: { multi_match: { query: q, fields: ["title^2", "description"] } },
    });
    return result.hits.hits.map((h) => {
      const src = h._source as ListDoc;
      return { id: h._id as string, title: src.title, username: src.username, itemCount: src.itemCount };
    });
  } catch (err) {
    warnEs("list search", err);
    return [];
  }
}

export interface EsLabelHit {
  id: string;
  name: string;
  area?: string;
}
export async function esSearchLabels(q: string, size = 10): Promise<EsLabelHit[]> {
  try {
    const result = await es.search<{ name: string; area?: string }>({
      index: LABEL_INDEX,
      size,
      // Match either script: "Fishmans" and "フィッシュマンズ" both find the artist.
      query: {
        multi_match: { query: q, fields: ["name", "latinName"], operator: "and" },
      },
    });
    return result.hits.hits.map((h) => {
      const src = h._source as { name: string; area?: string };
      return { id: h._id as string, name: src.name, area: src.area };
    });
  } catch (err) {
    warnEs("label search", err);
    return [];
  }
}
