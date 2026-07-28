/**
 * The bytes half of avatars: validate what a user handed us, normalize it to a
 * durable master, and derive rendition widths from that master on demand.
 *
 * `avatarStorage.ts` owns the URL shape and the on-disk layout; this module owns
 * the pixels. Same split as `coverProxy.ts` / `coverCache.ts`.
 *
 * ## These bytes are hostile until proven otherwise
 *
 * The covers pipeline processes images from the Cover Art Archive — a source
 * that is unreliable but not adversarial. This one processes whatever an
 * authenticated stranger chose to send, which is a different threat model
 * wearing the same shape. The ordering below is the whole point: **every cheap
 * check that can reject the bytes runs before sharp is handed anything**,
 * because the expensive failures (a decompression bomb, a 40,000×40,000 PNG
 * that allocates gigabytes) happen inside the decoder, and a check that runs
 * after the decode has already lost.
 *
 *   1. size, at the transport, while reading
 *   2. magic bytes — the format claim, from the bytes themselves
 *   3. `limitInputPixels` — the allocator refuses before we have to notice
 *   4. `metadata()` — header only, no pixels: dimensions and frame count
 *   5. only now: rotate, resize, re-encode
 *
 * ## Three outcomes, and none of them is 503
 *
 * §1 governs UPSTREAM uncertainty: a 503 means "we could not tell", and it
 * exists because a rate-limited MusicBrainz must never be reported as a missing
 * release. There is no upstream here. Every answer this module gives is
 * definitive, so a rejected upload is a **400 naming the actual reason** and
 * never a 503, and never a silent no-op that leaves the user staring at an
 * unchanged picture wondering whether it worked.
 *
 * ## What re-encoding buys
 *
 * The decode-and-re-encode is itself the sanitizer. Nothing polyglot survives
 * it: a file that is a valid JPEG *and* a valid HTML document arrives as neither,
 * because what we write is bytes sharp produced from a pixel buffer, not bytes
 * the user sent. It is also where EXIF goes to die — see the note on
 * `withMetadata` below, which is a privacy control, not an encoding detail.
 */
import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import sharp from "sharp";
import { HttpError } from "../middleware/errorHandler.js";
import { writeFileAtomically } from "./atomicWrite.js";
import {
  AVATAR_HASH_LENGTH,
  AVATAR_MASTER_SIZE,
  AVATAR_WIDTHS,
  avatarUrlFor,
  masterPath,
  variantPath,
  type AvatarWidth,
} from "./avatarStorage.js";

/**
 * The upload ceiling. Generous for a photograph, small enough that a hundred
 * concurrent uploads cannot exhaust memory — the route enforces this at the
 * transport too (`express.raw({ limit })`), so nothing ever buffers past it.
 * Checked again here because this module must not assume its only caller is
 * that route: Phase 7's mobile client and any future import script go through
 * the same door.
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Pixel ceiling, tighter than the covers' 50 MP. An avatar rendered at 384px
 * has no legitimate reason to arrive as a 50-megapixel scan, and the gap
 * between "plausible photograph" and "deliberate decompression bomb" is where
 * this number lives. sharp refuses before allocating, which is the point:
 * noticing afterwards means the allocation already happened.
 */
const MAX_INPUT_PIXELS = 24_000_000;

/**
 * Per-side ceiling. A 20,000×1 image is only 20,000 pixels and sails past the
 * megapixel cap, while still being a shape no avatar has and a resize target
 * that behaves badly.
 */
const MAX_DIMENSION = 8_000;

const WEBP_QUALITY = 82;

/**
 * Formats we accept, identified by their leading bytes.
 *
 * The `Content-Type` header and the filename are ignored completely. Both are
 * claims made by the caller about bytes the caller also chose; only the bytes
 * are evidence. This allowlist is also what rejects **SVG**, which matters more
 * than the others: sharp will happily rasterize SVG, and SVG is a scripting and
 * XXE vector wearing an image's clothes. It is text, so it matches nothing here.
 *
 * GIF is deliberately absent. It exists largely to be animated, supporting it
 * means deciding what an animated avatar does on every surface, and excluding
 * it is one fewer thing to defend for a format nobody uploads as a portrait.
 */
const SIGNATURES: ReadonlyArray<{ format: string; test: (b: Buffer) => boolean }> = [
  { format: "JPEG", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    format: "PNG",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    format: "WebP",
    // RIFF....WEBP — the four-byte length between the two markers is why this
    // cannot be a single prefix comparison.
    test: (b) =>
      b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/**
 * Recognise HEIC/HEIF so it can be REJECTED with a message that names it.
 *
 * Not an accepted format — this is purely so the error is actionable. HEIC is
 * an ISO-BMFF file: a length-prefixed `ftyp` box at offset 4, with the brand at
 * offset 8. The brands below are what Apple's camera and Photos produce.
 */
function isHeic(b: Buffer): boolean {
  if (b.length < 12 || b.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = b.subarray(8, 12).toString("ascii");
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
}

/** In-flight renders, so a burst for one avatar renders it exactly once. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Validate `input`, write the durable master, and return the hash and the URL
 * to store on the user's row.
 *
 * Throws `HttpError(400, …)` with a reason a person can act on. It does not
 * write the database row — the caller does, after this resolves, so a rejected
 * upload cannot leave `avatarUrl` pointing at a file that was never written.
 */
export async function ingestAvatar(
  userId: string,
  input: Buffer
): Promise<{ hash: string; url: string; bytes: number }> {
  // 1. Size. The route caps this at the transport; this is the backstop for
  //    every other caller.
  if (input.byteLength === 0) {
    throw new HttpError(400, "That upload was empty.");
  }
  if (input.byteLength > MAX_AVATAR_BYTES) {
    // Both figures in the same unit. Dividing the MiB cap by 1e6 renders the
    // limit as "5.24288 MB" next to a size in MB — a message that reads as a
    // bug to the one person guaranteed to see it.
    const mib = (n: number) => n / (1024 * 1024);
    throw new HttpError(
      400,
      `That image is ${mib(input.byteLength).toFixed(1)} MB. The limit is ${mib(MAX_AVATAR_BYTES)} MB.`
    );
  }

  // 2. Magic bytes. Before any decoder sees this.
  const signature = SIGNATURES.find((s) => s.test(input));
  if (!signature) {
    // HEIC gets named rather than lumped in with "not an image", because it is
    // BY FAR the most likely rejection: an iPhone photo library hands over HEIC
    // unless the file input narrows `accept` to concrete types, so this is the
    // first thing a real phone will send. "That file is not a JPEG, PNG or
    // WebP" is technically true and useless to someone holding a photo they can
    // plainly see.
    if (isHeic(input)) {
      throw new HttpError(
        400,
        "iPhone photos in HEIC format aren't supported yet — please choose a JPEG or PNG."
      );
    }
    throw new HttpError(400, "That file is not a JPEG, PNG or WebP image.");
  }

  // 3 + 4. Header only — `metadata()` parses the header and does not decode the
  //        image, so the dimension and frame checks below happen before any
  //        pixel buffer is allocated. `limitInputPixels` is armed here so that
  //        even this much refuses a bomb.
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    // Bytes that pass the signature check but will not parse are corrupt or
    // truncated. Definitive, and the user's to fix — not a retry.
    throw new HttpError(400, `That ${signature.format} could not be read: ${(err as Error).message}`);
  }

  if (!meta.width || !meta.height) {
    throw new HttpError(400, "That image reports no dimensions.");
  }
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    throw new HttpError(
      400,
      `That image is ${meta.width}×${meta.height}. The limit is ${MAX_DIMENSION}px on a side.`
    );
  }
  // Animated WebP arrives as a multi-page image. Rejected explicitly rather
  // than silently flattened to frame one, because "we kept the first frame" is
  // a decision the uploader should get to make.
  if ((meta.pages ?? 1) > 1) {
    throw new HttpError(400, "Animated images are not supported as avatars — please upload a still.");
  }

  // The hash is of the ORIGINAL bytes, not the re-encoded output: re-uploading
  // the same file is then idempotent, producing the same URL and no cache churn.
  const hash = createHash("sha256").update(input).digest("hex").slice(0, AVATAR_HASH_LENGTH);

  // 5. Only now, pixels.
  let master: Buffer;
  try {
    master = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      // EXIF orientation honoured before the resize, or a phone photo comes out
      // sideways at every width.
      .rotate()
      // `cover`, unlike the covers pipeline's `inside`. There it would bake an
      // unrecognisable centre crop into a gatefold scan; here the image is
      // painted into a circle, so a square crop is what the surface actually
      // wants and letterboxing would put bars inside the circle.
      .resize(AVATAR_MASTER_SIZE, AVATAR_MASTER_SIZE, { fit: "cover", position: "centre" })
      // NO `.withMetadata()`. This is a privacy control, not an encoding
      // preference: sharp drops EXIF unless asked to keep it, and a phone photo
      // carries GPS coordinates. Re-serving those from our own origin would be
      // us publishing a user's home address to anyone who downloads their
      // avatar. If someone "fixes" this later to preserve colour profiles, the
      // orientation is already applied above and the location data is not worth
      // the trade.
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();
  } catch (err) {
    throw new HttpError(400, `That image could not be processed: ${(err as Error).message}`);
  }

  await writeFileAtomically(masterPath(userId, hash), master);

  return { hash, url: avatarUrlFor(userId, hash), bytes: master.byteLength };
}

/**
 * The rendition at `width`, rendering it from the master on first ask.
 *
 * Returns the file path, or `null` when there is no master — which is a genuine
 * 404: either the user has no avatar, or the URL names a hash they no longer
 * have. Both are definitive answers, so neither is a 503.
 */
export function ensureAvatarVariant(
  userId: string,
  hash: string,
  width: AvatarWidth
): Promise<string | null> {
  const file = variantPath(userId, hash, width);
  const existing = inFlight.get(file);
  if (existing) return existing;

  const job = renderVariant(userId, hash, width, file).finally(() => inFlight.delete(file));
  inFlight.set(file, job);
  return job;
}

async function renderVariant(
  userId: string,
  hash: string,
  width: AvatarWidth,
  file: string
): Promise<string | null> {
  const cached = await stat(file).catch(() => null);
  if (cached?.isFile()) return file;

  const master = await readFile(masterPath(userId, hash)).catch(() => null);
  if (!master) return null;

  // The master is already ours — validated, normalized, square, and written by
  // this process. No gauntlet needed on the way back out; the only untrusted
  // input was the original upload.
  const encoded = await sharp(master)
    .resize(width, width, { fit: "cover", position: "centre" })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer();

  await writeFileAtomically(file, encoded);
  return file;
}

/**
 * Remove an avatar's master and every rendition derived from it.
 *
 * Used by `DELETE /api/me/avatar` and, later, by account deletion — where §5's
 * `deleteReleaseEverywhere` reasoning applies unchanged: a delete that leaves
 * the bytes on disk is not a delete, and for a photograph of a person that is
 * the difference between honouring a deletion request and appearing to.
 *
 * Best-effort per file. A rendition that fails to unlink is orphaned disk, not
 * a leak: it is unreachable, because the URL that names it is gone from the row
 * and the hash is not guessable.
 */
export async function deleteAvatarFiles(userId: string, hash: string): Promise<void> {
  await rm(masterPath(userId, hash), { force: true }).catch(() => {});
  await Promise.all(
    AVATAR_WIDTHS.map((w) => rm(variantPath(userId, hash, w), { force: true }).catch(() => {}))
  );
}

/** Test seam: drop in-flight state between cases. */
export function __resetAvatarState(): void {
  inFlight.clear();
}
