import { Link } from "react-router-dom";
import { splitArtistCredit, isSearchableName } from "../../lib/artistCreditSplit";

/**
 * An artist credit that is ALWAYS reachable.
 *
 * Previously every surface rendered `artistId ? <Link> : <span>`, so any release
 * we couldn't tie to a single MusicBrainz artist became dead text — most visibly
 * multi-artist credits like "New Order, Joy Division" on a Discogs-only
 * compilation, where neither artist was clickable even though both have pages.
 *
 * When we have a resolved artist we link straight to it. When we don't, we do
 * NOT guess an identity by name (the 5.8 rule) — we split the credit and send
 * each name to search, which is honest about the uncertainty and still gets the
 * reader where they want to go.
 */
export function ArtistCredit({
  artistId,
  artistName,
  className = "artist-link meta",
  style,
}: {
  artistId?: string | null;
  artistName: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (artistId) {
    return (
      <Link to={`/artist/${artistId}`} className={className} style={style}>
        {artistName}
      </Link>
    );
  }

  // An unresolved credit is linked to search — §3's navigation affordance, and
  // the only place a NAME is allowed to stand in for identity.
  //
  // Splitting used to be `", "` only, on the belief that both sources join that
  // way. MusicBrainz carries a per-credit `joinphrase` and routinely uses " & ",
  // " feat. " or "/", so "ZZ Top & Gary Moore" stayed one fragment and became a
  // query no human would type: unmatchable, cache-poisoning, and a MusicBrainz
  // slot spent every time anything walked the link (6.3e follow-up #9).
  //
  // A fragment that still is not a plausible name — punctuation debris, or a
  // Discogs role string like "Directed For The Stage By Peter Konwitschny" — is
  // rendered as text rather than linked. §8 says a credit is never dead text,
  // and it is right; but a link to a search that cannot match is a worse
  // promise than plain text, because it looks like it works.
  const names = splitArtistCredit(artistName);
  return (
    <span className={className} style={style}>
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 && ", "}
          {isSearchableName(name) ? (
            <Link to={`/search?q=${encodeURIComponent(name)}`} className={className}>
              {name}
            </Link>
          ) : (
            name
          )}
        </span>
      ))}
    </span>
  );
}
