// Transactional email, via Resend.
//
// Three rules govern this file, all of them CLAUDE.md laws applied to a
// provider that happens to send mail rather than return metadata:
//
//  §1  A send that failed because Resend was busy is NOT a send that failed
//      because the address is bad. Retry-able conditions (5xx / 429 / timeout /
//      dropped socket) throw UpstreamUnavailableError; a definitive rejection
//      (bad address, unverified sending domain) returns `delivered: false` with
//      a reason. Collapsing those two together is how "your email is invalid"
//      gets shown to someone whose email is fine.
//
//  §7  The API key travels in an Authorization HEADER, never a URL parameter,
//      and lives only in .env.production on the server.
//
//  Fault isolation: NOTHING here may fail the request that triggered it.
//  Registration succeeding and the welcome mail failing is a mild annoyance
//  with a "resend" button behind it; registration failing because an email
//  provider had a bad minute is data loss for the user. Call sites wrap every
//  send — see sendVerificationEmail's use in authService.
import { env } from "../config/env.js";
import { UpstreamUnavailableError } from "./musicbrainzService.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

// Same list the MusicBrainz client uses: these mean "ask again", not "no".
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Whether transactional email is configured at all.
 *
 * Exported so routes can tell a user "check your inbox" only when an inbox is
 * actually going to receive something.
 */
export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export interface SendResult {
  delivered: boolean;
  /** Resend's message id, when it accepted the message. */
  id?: string;
  /** Why it was not delivered — only set when `delivered` is false. */
  reason?: string;
}

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send one message.
 *
 * @throws UpstreamUnavailableError when Resend is unreachable or busy. The
 *   caller decides whether that is worth surfacing; for user-triggered sends the
 *   retry affordance is the "resend" endpoint, not an automatic retry — a
 *   retried send that actually succeeded the first time delivers twice.
 */
export async function sendEmail({ to, subject, html, text }: SendInput): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    // Not an error. This is the documented unconfigured path, and it must be
    // loud enough to explain a missing email but quiet enough not to look like
    // a fault in a deployment that has deliberately not wired mail up yet.
    console.warn(`[email] RESEND_API_KEY unset — skipping "${subject}" to ${to}`);
    return { delivered: false, reason: "not-configured" };
  }

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        // Header, not a query parameter (§7).
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    // A dropped socket or a timeout is the textbook retry-able condition. This
    // is the exact shape that 500'd an already-seeded release when an
    // unguarded Cover Art Archive fetch threw `TypeError: fetch failed`.
    throw new UpstreamUnavailableError("resend", `send failed: ${(err as Error).message}`);
  }

  if (RETRYABLE_STATUS.has(res.status)) {
    throw new UpstreamUnavailableError("resend", `HTTP ${res.status} sending "${subject}"`);
  }

  if (!res.ok) {
    // Definitive: a bad address, or a From: domain that is not verified in
    // Resend. Retrying will produce the same answer, so say so permanently.
    const body = await res.text().catch(() => "");
    const reason = `HTTP ${res.status} ${body.slice(0, 200)}`;
    console.error(`[email] rejected "${subject}" to ${to}: ${reason}`);
    return { delivered: false, reason };
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { delivered: true, id: body.id };
}

// ---------------------------------------------------------------------------
// Templates
//
// Deliberately plain: inline styles only, no external CSS or images, a text
// part alongside every HTML part. Mail clients strip <style> blocks, and a
// message with no text/plain alternative scores as spam regardless of how
// perfectly SPF, DKIM and DMARC are configured.
// ---------------------------------------------------------------------------

const INK = "#12100e";
const GOLD = "#c8a24a";

/**
 * `cta` is optional because not every transactional email should carry a link.
 * The email-change notice to the OLD address is a tripwire, and a button in it
 * would be one more thing for a phisher to imitate — the safest version of
 * "someone is trying to take your account" asks you to go to the site yourself.
 */
function shell(heading: string, body: string, cta?: { href: string; label: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${INK};color:#efe9dd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1b1815;border-radius:12px;padding:32px;">
        <tr><td>
          <div style="font-size:20px;font-weight:700;color:${GOLD};letter-spacing:0.02em;margin-bottom:24px;">Soundlog</div>
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#efe9dd;">${heading}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#bdb3a4;">${body}</p>
          ${
            cta
              ? `<a href="${cta.href}" style="display:inline-block;background:${GOLD};color:${INK};text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">${cta.label}</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#8b8275;">
            If the button does not work, paste this link into your browser:<br>
            <span style="color:#bdb3a4;word-break:break-all;">${cta.href}</span>
          </p>`
              : ""
          }
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function verificationEmail(link: string): Omit<SendInput, "to"> {
  return {
    subject: "Confirm your email — Soundlog",
    html: shell(
      "Confirm your email",
      "You're one click from a finished Soundlog account. This link is good for 24 hours.",
      { href: link, label: "Confirm email" }
    ),
    text: [
      "Confirm your email",
      "",
      "You're one click from a finished Soundlog account.",
      "This link is good for 24 hours:",
      link,
      "",
      "If you didn't create a Soundlog account, ignore this message.",
    ].join("\n"),
  };
}

/**
 * Sent to the NEW address. Clicking it is what proves control of the mailbox
 * being moved to, and is the only thing that makes the change take effect.
 */
export function emailChangeEmail(link: string, newEmail: string): Omit<SendInput, "to"> {
  return {
    subject: "Confirm your new email — Soundlog",
    html: shell(
      "Confirm your new email",
      `Confirm that ${newEmail} should become the address you sign in with. This link works once and expires in 2 hours. Until you click it, nothing changes and your old address still works.`,
      { href: link, label: "Confirm new email" }
    ),
    text: [
      "Confirm your new email",
      "",
      `Confirm that ${newEmail} should become the address you sign in with.`,
      "This link works once and expires in 2 hours:",
      link,
      "",
      "Until you click it, nothing changes and your old address still works.",
      "If you didn't ask for this, ignore this message.",
    ].join("\n"),
  };
}

/**
 * Sent to the OLD address, for its own sake rather than the user's convenience.
 *
 * If someone else has taken the account, the legitimate owner's only warning is
 * a message at the address they still control — and it has to arrive when the
 * change is REQUESTED, not when it completes, because by then the attacker
 * holds the mailbox the confirmation went to. Deliberately carries no link and
 * no action: it is a tripwire, and a link in it would be one more thing to
 * phish.
 */
export function emailChangeNoticeEmail(newEmail: string): Omit<SendInput, "to"> {
  return {
    subject: "Someone asked to change your Soundlog email",
    html: shell(
      "Email change requested",
      `We received a request to change this account's email to ${newEmail}. It does not take effect until that address is confirmed. If this was you, no action is needed. If it wasn't, change your password now — someone else may have access to your account.`
    ),
    text: [
      "Email change requested",
      "",
      `We received a request to change this account's email to ${newEmail}.`,
      "It does not take effect until that address is confirmed.",
      "",
      "If this was you, no action is needed.",
      "If it wasn't, change your password now — someone else may have access.",
    ].join("\n"),
  };
}

export function passwordResetEmail(link: string): Omit<SendInput, "to"> {
  return {
    subject: "Reset your password — Soundlog",
    html: shell(
      "Reset your password",
      "Use the link below to choose a new password. It works once and expires in 1 hour. If you didn't ask for this, nothing has changed and you can ignore this email.",
      { href: link, label: "Choose a new password" }
    ),
    text: [
      "Reset your password",
      "",
      "Use the link below to choose a new password.",
      "It works once and expires in 1 hour:",
      link,
      "",
      "If you didn't ask for this, nothing has changed — ignore this email.",
    ].join("\n"),
  };
}
