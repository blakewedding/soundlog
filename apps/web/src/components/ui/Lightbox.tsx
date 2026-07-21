import { useEffect, useRef } from "react";

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
 *
 * Modal keyboard contract, all three parts of it:
 *   - focus moves INTO the dialog on open, so the next Tab is inside it;
 *   - focus is TRAPPED, so Tab can't wander onto the page behind an overlay
 *     that covers it;
 *   - focus RETURNS to whatever opened it on close, so the keyboard user is put
 *     back where they were rather than at the top of the document.
 * Without these an aria-modal dialog lies about being modal.
 */
export function Lightbox({ src, alt, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Wrap at both ends so Tab and Shift+Tab stay inside the overlay.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — full size`}
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        className="btn btn-ghost lightbox-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        Close
      </button>
      {/* Clicking the image itself shouldn't close the overlay. */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
