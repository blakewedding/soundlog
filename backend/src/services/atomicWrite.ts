/**
 * Write a file via a `.partial` sibling and rename it into place.
 *
 * The same rule the database backups follow: a directory must never contain a
 * truncated file that looks complete, because the next reader would serve it as
 * one. rename(2) within a filesystem is atomic, so a reader sees either the old
 * file or the whole new one and never a half-written one.
 *
 * Extracted from `coverCache.ts` in 6.2, when avatars needed the identical
 * discipline for a much less forgiving reason: a truncated cover rendition is a
 * broken tile that the next request re-fetches, while a truncated avatar master
 * is the only copy of a picture that no longer exists anywhere else.
 *
 * The pid in the temporary name keeps two processes writing the same target
 * from clobbering each other's partial — which matters for the cover cache
 * under a concurrent burst, and would matter for avatars if the API were ever
 * run as more than one process (see §7a, which is why it is not).
 */
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeFileAtomically(file: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  try {
    await writeFile(partial, data);
    await rename(partial, file);
  } catch (err) {
    await unlink(partial).catch(() => {});
    throw err;
  }
}
