// Send one real message through the configured mail provider.
//
//   npx tsx scripts/send-test-email.ts you@example.com
//
// In production, via the maintenance image:
//
//   docker compose --env-file .env.production -f docker-compose.prod.yml \
//     run --rm --entrypoint sh migrate -c "npx tsx scripts/send-test-email.ts you@example.com"
//
// Why this exists rather than "just register an account": registering to test
// mail creates a real user row on a live site, with a real address, that then
// has to be cleaned up. This sends without touching any data.
//
// What it proves is DELIVERY, not authentication. SPF, DKIM and DMARC are
// evaluated by the RECEIVING server, so the only place their result appears is
// the Authentication-Results header of the message as received. Read that in
// Gmail via "Show original"; a 200 from the provider here says nothing about
// whether the message will be trusted.
import { sendEmail, emailConfigured } from "../src/services/emailService.js";
import { env } from "../src/config/env.js";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("usage: npx tsx scripts/send-test-email.ts <address>");
    process.exitCode = 1;
    return;
  }

  if (!emailConfigured()) {
    console.error("RESEND_API_KEY is not set — nothing would be sent.");
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString();
  console.log(`from: ${env.EMAIL_FROM}`);
  console.log(`to:   ${to}`);

  const result = await sendEmail({
    to,
    subject: `Soundlog production mail test — ${stamp}`,
    html:
      `<p>Sent from the Soundlog production stack at <strong>${stamp}</strong>.</p>` +
      `<p>Open <em>Show original</em> in Gmail and read the Authentication-Results ` +
      `header: SPF, DKIM and DMARC are judged by the receiving server, never by us.</p>`,
    text: [
      `Sent from the Soundlog production stack at ${stamp}.`,
      "",
      "Open 'Show original' in Gmail and read the Authentication-Results header:",
      "SPF, DKIM and DMARC are judged by the receiving server, never by us.",
    ].join("\n"),
  });

  if (result.delivered) {
    console.log(`ACCEPTED by provider, message id: ${result.id}`);
    console.log("This means accepted for delivery — not that it passed authentication.");
  } else {
    console.error(`NOT DELIVERED: ${result.reason}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  // An UpstreamUnavailableError here means the provider was busy or unreachable
  // — a retry-able condition, not a configuration error. Say which it is.
  console.error(`${err?.name ?? "Error"}: ${err?.message ?? err}`);
  process.exitCode = 1;
});
