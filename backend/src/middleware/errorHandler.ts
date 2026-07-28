import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { UpstreamUnavailableError } from "../services/musicbrainzService.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * body-parser's oversize error, identified by its `type` rather than only by a
 * status. Every body-parser error carries a status, so matching on 413 alone
 * would be broad; `entity.too.large` is the specific condition.
 */
function isPayloadTooLarge(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { type?: string; status?: number; statusCode?: number };
  return e.type === "entity.too.large" || e.status === 413 || e.statusCode === 413;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: "Validation failed", details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // body-parser refuses an oversized body BEFORE any route runs, by throwing
  // rather than by returning — so without this branch it fell through to the
  // generic 500 below and a 6 MB upload answered "Internal server error".
  //
  // That is the §1 mistake in a different costume: a definite, explainable,
  // caller-fixable condition reported as an opaque server fault. The person
  // uploading can act on "that image is too large"; they can do nothing at all
  // with a 500.
  if (isPayloadTooLarge(err)) {
    return res
      .status(413)
      .json({ error: "That image is too large — the limit is 5 MB." });
  }

  // A retry-able upstream blip is NOT "not found". Say so honestly (503 +
  // Retry-After) so clients can retry instead of concluding the resource is gone.
  if (err instanceof UpstreamUnavailableError) {
    console.warn(`[upstream] ${err.message}`);
    return res
      .status(503)
      .set("Retry-After", "2")
      .json({ error: "Upstream metadata source is busy — please retry in a moment." });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}
