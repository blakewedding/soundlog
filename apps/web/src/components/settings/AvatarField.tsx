import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OwnProfile } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { patchUserEverywhere } from "../../lib/userCache";
import { Avatar } from "../ui/Avatar";

/**
 * Formats the backend will accept, named EXPLICITLY rather than as `image/*`.
 *
 * This attribute is load-bearing on iOS. An iPhone photo library hands over
 * HEIC when the input accepts anything, and Safari transcodes to JPEG when it
 * sees concrete types it can convert to. Widening this to `image/*` is what
 * turns "pick a photo" into a 400 on the most common device we have.
 *
 * No `capture` attribute on purpose: `capture` forces the camera and removes
 * the library, which is the opposite of what someone setting a profile picture
 * usually wants.
 */
const ACCEPT = "image/jpeg,image/png,image/webp";

interface Props {
  profile: OwnProfile;
  onChange: (next: OwnProfile) => void;
}

export function AvatarField({ profile, onChange }: Props) {
  const qc = useQueryClient();
  const { refreshUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A local object URL, shown the instant a file is picked so the tile moves on
  // click (§6) rather than after a round trip that includes an image encode.
  const [preview, setPreview] = useState<string | null>(null);

  // Object URLs are a document-lifetime leak until revoked, and this component
  // can create one per attempt.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  /** Everything that must agree after the avatar changes (§6). */
  async function propagate(next: OwnProfile) {
    onChange(next);
    // Every cached query embedding this user — feed, reviews, comments,
    // follower lists — not merely the page in front of us.
    patchUserEverywhere(qc, next.id, { avatarUrl: next.avatarUrl });
    // The nav renders the session user, which is a separate object.
    await refreshUser();
  }

  async function upload(file: File) {
    setError(null);

    // Caught here rather than at the server so the person holding the phone
    // gets the answer without a 5 MB round trip. Safari usually transcodes
    // HEIC on its way out of the picker, so this fires only when it did not.
    if (/heic|heif/i.test(file.type)) {
      setError("iPhone photos in HEIC format aren't supported yet — please choose a JPEG or PNG.");
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy("upload");
    try {
      const { profile: next } = await api.uploadAvatar(file);
      await propagate(next);
      // Drop the local preview the moment the real URL exists.
      //
      // Not housekeeping — the two images DIFFER. The preview is the file as
      // picked; what the server stores is centre-cropped square. Leaving the
      // preview up shows the uploader an uncropped picture while everyone else
      // sees the crop, and they only discover it on someone else's screen.
      setPreview(null);
      URL.revokeObjectURL(localUrl);
    } catch (err) {
      // Roll back to whatever was there before, and SAY so. A bare await with
      // no catch is what makes a click silently do nothing.
      setPreview(null);
      URL.revokeObjectURL(localUrl);
      setError(err instanceof ApiError ? err.message : "That upload didn't go through.");
    } finally {
      setBusy(null);
      // Clear the input, or picking the same file twice after a failure fires
      // no change event and the retry appears to do nothing.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setBusy("delete");
    try {
      const { profile: next } = await api.deleteAvatar();
      setPreview(null);
      await propagate(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that picture.");
    } finally {
      setBusy(null);
    }
  }

  const shown = preview ?? profile.avatarUrl;

  return (
    <div className="settings-avatar">
      <div className={busy === "upload" ? "img-loading" : undefined}>
        {/* Preview is a blob: URL, which the rendition helper correctly passes
            through untouched rather than trying to resize. */}
        <Avatar src={shown} name={profile.displayName ?? profile.username} size="hero" decorative={false} />
      </div>

      <div className="settings-avatar-actions">
        <input
          ref={fileRef}
          id="avatar-file"
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          disabled={busy !== null}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {/* A styled label rather than a bare file input: the native control is
            unstyleable and reads as "Choose file / no file chosen", which is
            not what this does. */}
        <label htmlFor="avatar-file" className="btn btn-primary" aria-disabled={busy !== null}>
          {busy === "upload" ? "Uploading…" : profile.avatarUrl ? "Change picture" : "Upload a picture"}
        </label>

        {profile.avatarUrl && (
          <button type="button" className="btn btn-ghost" onClick={() => void remove()} disabled={busy !== null}>
            {busy === "delete" ? "Removing…" : "Remove"}
          </button>
        )}

        <p className="meta settings-hint">JPEG, PNG or WebP, up to 5 MB. Square works best.</p>

        {error && (
          <p className="meta settings-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
