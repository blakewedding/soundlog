import { Link } from "react-router-dom";

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

  // MusicBrainz and Discogs both join multiple credits with ", ".
  const names = artistName.split(/,\s*/).filter(Boolean);
  return (
    <span className={className} style={style}>
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 && ", "}
          <Link to={`/search?q=${encodeURIComponent(name)}`} className={className}>
            {name}
          </Link>
        </span>
      ))}
    </span>
  );
}
