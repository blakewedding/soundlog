// Account deletion — App Store Review 5.1.1(v), on the deleteReleaseEverywhere
// precedent (§5): Postgres AND Elasticsearch, or it is not a delete.
//
// This one goes further than the release case, because a user has bytes and a
// release does not. Five stores hold something after a user row is gone, and a
// delete that clears four of them is a delete that appears to work:
//
//   1. Postgres    — 12 direct cascades + 3 indirect. Automatic.
//   2. Elasticsearch — the `users` document, and one `lists` document per
//      public list. The list documents are the trap: cascading a User in
//      Postgres deletes the List rows and touches ES not at all, so every
//      public list a deleted member made stays searchable. Identical in shape
//      to the 1,070 orphaned documents 5.5 found.
//   3. Disk        — the avatar master and every rendition derived from it.
//   4. Cloudflare  — edge copies of those renditions, `immutable` for a year.
//      Measured, not assumed: see cloudflarePurge.ts.
//   5. Redis       — the denylist entry that stops the last access tokens.
//
// ## The ordering is the design
//
// The Postgres delete is irreversible and there is nobody left to retry after
// it: the user cannot authenticate to try again. So everything that CAN fail
// retryably is either done or PROVEN POSSIBLE before Postgres is touched.
//
//   preflight the purge credential  ─┐  fail here → nothing deleted, 503 +
//   de-index user + lists (strict)  ─┘  Retry-After, the user simply tries again
//   ──────────────────────────────────  the point of no return
//   delete from Postgres
//   deny the access tokens
//   unlink the avatar bytes
//   purge the edge
//
// The purge runs AFTER the row and the bytes are gone, not before, so that the
// window between purging and deleting cannot re-cache the very image being
// purged. The preflight is what buys that ordering safely: it converts "the
// token is wrong" from residue into an ordinary retryable refusal.
//
// Anything that fails after the point of no return is REPORTED, never
// swallowed. `residue` is what the route turns into a 502 that says the account
// was deleted and names what survived — because reporting a successful deletion
// when a photograph is still on a CDN is the exact lie this file exists to
// prevent.
import { prisma } from "../config/database.js";
import { deindexUser, deindexUserStrict, deindexListStrict } from "./searchService.js";
import { avatarFilesRemaining, deleteAvatarFiles } from "./avatarService.js";
import { parseAvatarPath } from "./avatarStorage.js";
import { cloudflarePurgeConfigured, purgeAvatar, verifyPurgeCredentials } from "./cloudflarePurge.js";
import { denyUserTokens } from "./tokenDenylist.js";
import { UpstreamUnavailableError } from "./musicbrainzService.js";

/** One layer that did not come clean, after the account itself was removed. */
export interface DeletionResidue {
  layer: "avatar-files" | "cloudflare" | "token-denylist";
  detail: string;
}

export interface DeleteUserResult {
  /** Whether a Postgres row was actually removed. False means it was already gone. */
  deleted: boolean;
  /** Empty means every layer came clean. Non-empty is a 502, not a 200. */
  residue: DeletionResidue[];
  /**
   * What happened at the edge.
   *
   * FOUR outcomes, not three, and the split between the two `skipped` values is
   * the point. Caught on the production pass: an account with no avatar
   * reported `skipped-unconfigured` on a stack where the credential was
   * present and working, because "nothing to purge" fell through to the
   * unconfigured default. Both are honest about not having purged, which is
   * what stops a non-purge reading as a purge — but they say different things
   * about the SYSTEM, and an operator reading `skipped-unconfigured` on a
   * correctly-configured box would go looking for a missing token that is not
   * missing.
   */
  purge: "purged" | "skipped-no-avatar" | "skipped-unconfigured" | "failed";
}

/**
 * Remove a user from every store that holds anything about them.
 *
 * @throws before anything is destroyed when the edge credential cannot be
 *   confirmed or Elasticsearch will not give up its documents. Both leave the
 *   account intact and are safe to retry.
 */
export async function deleteUserEverywhere(userId: string): Promise<DeleteUserResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, avatarUrl: true },
  });

  if (!user) {
    // Mirrors deleteReleaseEverywhere: clear any orphaned document regardless,
    // so a half-finished earlier attempt is completed rather than remembered.
    //
    // The SWALLOWING variant here, not the strict one, and the asymmetry is
    // intentional: there is no delete left to abort. The row is already gone,
    // so failing loudly would turn a best-effort tidy-up into a 503 on an
    // operation that has nothing left to do.
    await deindexUser(userId);
    return { deleted: false, residue: [], purge: "skipped-no-avatar" };
  }

  // Read the things that stop being readable once the row is gone.
  const lists = await prisma.list.findMany({ where: { userId }, select: { id: true } });
  const avatar = user.avatarUrl ? parseAvatarPath(user.avatarUrl) : null;

  // ---- before the point of no return -------------------------------------

  const purgeConfigured = cloudflarePurgeConfigured();
  if (avatar && purgeConfigured) {
    // Nothing has been destroyed yet, so this is an ordinary retryable refusal
    // rather than residue. 503 for the same reason as the index below: a raw
    // throw here would reach the user as an opaque 500 for a condition that is
    // definite, temporary from their side, and nothing to do with them.
    //
    // A wrongly-scoped token is not in fact retryable, and the log says which
    // it was — but there is nothing different to TELL the person, and the shape
    // that keeps them from believing they were half-deleted is the same one.
    try {
      await verifyPurgeCredentials();
    } catch (err) {
      console.error(`[deletion] aborted for ${userId} — edge purge unavailable:`, err);
      throw new UpstreamUnavailableError(
        "cloudflare",
        "We couldn't complete your deletion just now. Nothing was changed — please try again."
      );
    }
  }

  // Strict: a surviving document IS the harm here, so it must stop the delete
  // while the delete is still stoppable. See deindexDocStrict.
  //
  // Mapped to 503 + Retry-After rather than allowed to surface as a raw error.
  // Found by the vacuity drill, not by the happy path: with Elasticsearch
  // stopped, this answered `500 Internal server error`, which is §1's mistake
  // in the costume the 413 incident already wore — a definite, retryable,
  // caller-actionable condition reported as an opaque server fault. Nothing has
  // been deleted at this point, so "try again in a moment" is both true and
  // actionable, and it is the only honest thing to tell someone who came here
  // to erase themselves.
  try {
    await deindexUserStrict(userId);
    for (const list of lists) await deindexListStrict(list.id);
  } catch (err) {
    console.error(`[deletion] aborted for ${userId} — search index unavailable:`, err);
    throw new UpstreamUnavailableError(
      "elasticsearch",
      "We couldn't complete your deletion just now. Nothing was changed — please try again."
    );
  }

  // ---- the point of no return --------------------------------------------

  await prisma.$transaction([
    // Activities pointing AT this user, which no cascade covers: `Activity` is
    // owned by the actor, so a FOLLOW row created by someone else naming this
    // user as its target outlives them. The feed already skips an activity
    // whose target does not resolve, so this is debris rather than a leak — but
    // it is debris that silently shortens other people's feed pages, and it
    // names a person who asked to be erased.
    //
    // Deliberately FOLLOW only. The same orphaning exists for COMMENT and
    // REVIEW activities pointing at cascade-deleted targets; that sweep is
    // filed rather than done here, because it is a wider cleanup than a
    // deletion path should be quietly performing.
    prisma.activity.deleteMany({ where: { type: "FOLLOW", targetId: userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  // ---- after: failures are reported, never swallowed ----------------------

  const residue: DeletionResidue[] = [];

  try {
    await denyUserTokens(userId);
  } catch (err) {
    residue.push({
      layer: "token-denylist",
      detail: `access tokens remain valid until they expire: ${(err as Error).message}`,
    });
  }

  if (avatar) {
    await deleteAvatarFiles(userId, avatar.hash);
    // Verified, not assumed. deleteAvatarFiles swallows every unlink error by
    // design, so awaiting it proves nothing about whether the bytes are gone —
    // and a residue check that can never fire is worse than no check, because
    // it reads as coverage.
    const left = await avatarFilesRemaining(userId, avatar.hash);
    if (left.length > 0) {
      residue.push({ layer: "avatar-files", detail: `${left.length} file(s) still on disk: ${left.join(", ")}` });
    }
  }

  // Not residue when unconfigured — a stack with no token is a legitimate
  // configuration, and saying "skipped" is what keeps it from reading as done.
  // The default is the no-avatar case: most accounts never upload one, and
  // reporting those as "unconfigured" would send an operator hunting a token
  // that is present.
  let purge: DeleteUserResult["purge"] = "skipped-no-avatar";
  if (avatar) {
    const outcome = await purgeAvatar(userId, avatar.hash);
    purge = outcome.status;
    if (outcome.status === "failed") {
      residue.push({ layer: "cloudflare", detail: outcome.detail });
    }
  }

  if (residue.length > 0) {
    // Loud, with the exact identifiers an operator needs, because there is no
    // durable retry queue in v1 and this log line is the record.
    console.error(
      `[deletion] user ${userId} removed from Postgres with residue:`,
      JSON.stringify(residue)
    );
  }

  return { deleted: true, residue, purge };
}
