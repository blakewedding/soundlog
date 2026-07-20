import { useEffect } from "react";

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * Full-size cover overlay. The large image is only requested when this mounts
 * (i.e. when the user opens it) — lists keep using thumbnails. Esc or a click
 * outside the image closes it; animation is disabled under reduced motion via
 * the .lightbox-backdrop CSS.
 */
export function Lightbox({ src, alt, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — full size`}
      onClick={onClose}
    >
      {/* Clicking the image itself shouldn't close the overlay. */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
