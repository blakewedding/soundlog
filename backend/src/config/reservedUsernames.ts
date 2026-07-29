/**
 * Usernames nobody may register.
 *
 * ## Why this has to exist
 *
 * The web client routes `/:username` as a catch-all, LAST, so that static
 * routes win the match. That precedence is correct — but it means every static
 * route segment is a name whose owner would have a permanently unreachable
 * profile. Registering `search` does not fail and does not warn; it quietly
 * produces an account nobody can visit, including its owner, and the only
 * remedy after the fact is renaming a live user.
 *
 * Eight segments were already exposed this way before anyone noticed: `diary`,
 * `explore`, `forgot-password`, `lists`, `login`, `reset-password`, `search`,
 * `verify-email`. None had been taken — checked against production — so this
 * closes a latent hole rather than repairing a live one. 6.2b's `/settings`
 * would have made nine, which is what prompted the check.
 *
 * ## Why it lives in the backend and not in @soundlog/shared
 *
 * `@soundlog/shared` is deliberately NOT a backend dependency (see CLAUDE.md),
 * and this list is a validation rule — it has to be enforced where accounts are
 * created or it is decoration. The client needs no copy: it shows whatever the
 * server says.
 *
 * The drift risk that remains — someone adds a route and forgets to reserve it
 * — is covered by `apps/web/src/App.reservedRoutes.test.ts`, which reads this
 * file and App.tsx from disk and fails in the package where the route was
 * added.
 *
 * ## Scope
 *
 *  - **Routes that exist today** — the concrete bug.
 *  - **Routes we will plausibly add** — cheap now, impossible later. Reserving
 *    `account` costs nothing today and cannot be done once someone holds it.
 *  - **Names that should never be a person** — `admin`, `support`, `official`.
 *    Not a routing problem: an account called `support` messaging users is a
 *    phishing primitive that costs nothing to prevent.
 *
 * Matching is case-insensitive; usernames validate as `[a-z0-9_]` and are
 * compared lowercased.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  // --- static routes that exist today (apps/web/src/App.tsx) ---
  "artist",
  "confirm-email",
  "diary",
  "explore",
  "forgot-password",
  "genre",
  "label",
  "list",
  "lists",
  "login",
  // Moved up from "likely to add" when the privacy policy shipped — it was
  // already reserved speculatively, which is exactly why adding the route cost
  // nothing. That is the case this list's second section exists to produce.
  "privacy",
  "release",
  "reset-password",
  "search",
  "settings",
  "verify-email",
  "year",

  // --- routes we are likely to add ---
  "about",
  "account",
  "auth",
  "billing",
  "help",
  "home",
  "logout",
  "notifications",
  "pricing",
  "pro",
  "register",
  "signin",
  "signup",
  "terms",
  "upgrade",

  // --- names that should never belong to a person ---
  "admin",
  "administrator",
  "api",
  "mod",
  "moderator",
  "official",
  "root",
  "security",
  "soundlog",
  "staff",
  "support",
  "system",
  "team",
  "www",
];

const RESERVED_SET = new Set(RESERVED_USERNAMES);

/** Is this name reserved? Case-insensitive; trims surrounding whitespace. */
export function isReservedUsername(username: string): boolean {
  return RESERVED_SET.has(username.trim().toLowerCase());
}
