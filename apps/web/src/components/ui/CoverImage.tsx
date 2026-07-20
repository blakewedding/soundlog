import { useState } from "react";

interface Props {
  src?: string | null;
  alt: string;
  zoomable?: boolean;
  onClick?: () => void;
}

/**
 * Album cover with progressive load: the .cover ink-2 background acts as the
 * placeholder, and the image fades in once fetched. Live seed-on-first-access
 * covers arrive late — this makes that read as loading, not breakage.
 *
 * Non-square artwork (cassette J-card spreads, gatefold scans) letterboxes
 * inside the tile instead of being center-cropped into an unrecognizable
 * smear by object-fit: cover.
 */
export function CoverImage({ src, alt, zoomable, onClick }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [letterbox, setLetterbox] = useState(false);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio > 1.3 || ratio < 0.77) setLetterbox(true);
    }
    setLoaded(true);
  }

  return (
    <div className={`cover${zoomable ? " cover-zoom" : ""}`} onClick={onClick}>
      {src && (
        <img
          src={src}
          alt={alt}
          className={loaded ? undefined : "img-loading"}
          style={letterbox ? { objectFit: "contain" } : undefined}
          onLoad={handleLoad}
          loading="lazy"
        />
      )}
    </div>
  );
}
