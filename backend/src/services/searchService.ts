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

/**
 * The normalised form stored in the `*Exact` keyword twins, and the form a query
 * is compared against.
 *
 * Lowercased and whitespace-collapsed in application code rather than by an
 * Elasticsearch `normalizer`, because a normalizer is an analysis setting and
 * analysis settings cannot be added to an open index — this has to be
 * applicable to the live one. Doing it here also means the write side and the
 * read side share one function and cannot drift.
 *
 * Deliberately NOT stripping punctuation: punctuation is the entire reason this
 * field exists.
 */
export function exactKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
        // Analyzer-proof twins. A title of pure punctuation ("!!!") analyses to
        // nothing and is otherwise unmatchable — see RELEASE_EXACT_PROPERTIES.
        titleExact: exactKey(release.title),
        artistNameExact: exactKey(release.artistName),
        // Standard-analysed twins: what rescues a DIGIT query, which the
        // edge-ngram pair indexes but can never match.
        titleStd: release.title,
        artistNameStd: release.artistName,
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
        // Multi-valued and search-only. Empty stays empty rather than becoming
        // `undefined`, so re-indexing an artist whose aliases were removed
        // upstream actually clears them.
        aliases: artist.aliases ?? [],
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
    const exact = exactKey(q);
    const result = await es.search<EsSource>({
      index: RELEASE_INDEX,
      size: 25,
      query: {
        bool: {
          // `should` + minimum_should_match, not `must`: the analysed match is
          // the normal path, and the keyword twin is the fallback for input the
          // analyser erases entirely. Either alone is a hit.
          //
          // Boosted above the text match because an exact string equality is a
          // stronger signal than an ngram overlap — if someone typed the title
          // exactly, that release is what they meant.
          should: [
            { multi_match: { query: q, fields: ["title^2", "artistName"] } },
            { term: { titleExact: { value: exact, boost: 4 } } },
            { term: { artistNameExact: { value: exact, boost: 3 } } },
            { multi_match: { query: q, fields: ["titleStd^2", "artistNameStd"] } },
          ],
          minimum_should_match: 1,
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

/**
 * Strip a leading English article, or return null when there isn't one.
 *
 * Used ONLY as a zero-result fallback (see {@link esSearchArtists}), never as an
 * index-side char filter and never as an unconditional rewrite. That distinction
 * is the whole design:
 *
 *   The The   -> "The"    The Who  -> "Who"    The Band -> "Band"
 *
 * Every one of those is a real, findable artist whose name IS the article plus a
 * word, and stripping at analysis time would make the canonical spelling
 * unsearchable in order to help the colloquial one. As a fallback it cannot: the
 * first query already matched, so the fallback never runs for them.
 */
export function stripLeadingArticle(q: string): string | null {
  const stripped = q.replace(/^\s*(the|a|an)\s+/i, "").trim();
  return stripped && stripped.toLowerCase() !== q.trim().toLowerCase() ? stripped : null;
}

function artistQuery(q: string) {
  return {
    // Match either script: "Fishmans" and "フィッシュマンズ" both find the artist —
    // and `aliases` carries the names MusicBrainz knows an artist by but does not
    // call canonical (6.3e).
    multi_match: {
      query: q,
      fields: ["name", "latinName", "aliases"],
      operator: "and" as const,
    },
  };
}

/**
 * Search seeded artists in Elasticsearch. Returns [] if ES is down.
 *
 * ## The leading-article fallback (6.3e)
 *
 * MusicBrainz's canonical name for the Portland band is `Chromatics`, and the
 * `operator: "and"` below requires every query term to match — so "The
 * Chromatics" could not match it at all. Not ranked low: **zero hits**, because
 * the document has no `the` token to satisfy.
 *
 * So a query that finds nothing is retried once with a leading article removed.
 * It is deliberately a fallback rather than an analyzer rule, because the
 * analyzer cannot tell "The Chromatics" (an article a user added) from "The The"
 * (an artist whose name is the article). A fallback can: it only ever runs when
 * the literal reading already came back empty.
 *
 * Worth being precise about what this does NOT fix. MusicBrainz does not list
 * "The Chromatics" as an alias for Chromatics — its only alias is `KRMTX` — so
 * alias indexing does not close this case, and there really are three unrelated
 * bands literally named "The Chromatics". This fallback is what makes the
 * colloquial spelling reach the canonical artist.
 */
export async function esSearchArtists(q: string, size = 5): Promise<EsArtistHit[]> {
  try {
    const hits = await runArtistQuery(q, size);
    if (hits.length > 0) return hits;

    const withoutArticle = stripLeadingArticle(q);
    if (!withoutArticle) return hits;
    return await runArtistQuery(withoutArticle, size);
  } catch (err) {
    warnEs("artist search", err);
    return [];
  }
}

async function runArtistQuery(q: string, size: number): Promise<EsArtistHit[]> {
  const result = await es.search<EsArtistSource>({
    index: ARTIST_INDEX,
    size,
    query: artistQuery(q),
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
}

// ---------------------------------------------------------------------------
// Members (users), lists, labels — indexed for the tabbed search (Phase 5).
// ---------------------------------------------------------------------------

/**
 * Index a member — or REMOVE them, if their profile is private.
 *
 * Same shape as `indexList` below, and for a stronger reason. §5 makes this
 * index a second place the same fact lives, and the one most likely to answer a
 * question nobody remembered to guard: a query-time filter has to be applied at
 * every call site forever, while an absent document cannot be returned by any
 * query anyone writes later.
 *
 * Must be called whenever `profileVisibility` changes, not only on
 * registration — going private has to take the document out.
 */
export async function indexUser(user: User): Promise<void> {
  try {
    if (user.profileVisibility === "PRIVATE") {
      await deindexUser(user.id);
      return;
    }
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

/**
 * De-index, and THROW if it did not happen.
 *
 * §5's default is the swallow above: an ES failure must never block a core
 * path, because Postgres is truth and the index is rebuildable. Account
 * deletion is the one caller for which that default is exactly wrong, and the
 * reason is worth stating rather than assuming.
 *
 * Everywhere else, a failed index write degrades a FEATURE — a release is
 * briefly missing from search and a re-index fixes it. Here, a failed de-index
 * leaves a document describing a person who has asked to be erased, in the
 * store §5 itself calls "the one most likely to answer a question nobody
 * remembered to guard". The residue is the harm, so it cannot be swallowed and
 * logged; it has to stop the delete while the delete is still stoppable.
 *
 * A 404 is success: the document is already absent, which is the outcome asked
 * for. Anything else propagates.
 */
async function deindexDocStrict(index: string, id: string): Promise<void> {
  try {
    await es.delete({ index, id });
  } catch (err) {
    const status = (err as { meta?: { statusCode?: number } }).meta?.statusCode;
    if (status !== 404) throw err;
  }
}
export const deindexListStrict = (id: string) => deindexDocStrict(LIST_INDEX, id);
export const deindexUserStrict = (id: string) => deindexDocStrict(USER_INDEX, id);

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
