import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { UpstreamUnavailableError } from "../services/musicbrainzService.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: "Validation failed", details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
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
