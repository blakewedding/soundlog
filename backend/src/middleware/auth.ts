import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "./errorHandler.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing access token");
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    throw new HttpError(401, "Invalid or expired access token");
  }
}

/**
 * Like requireAuth, but anonymous requests pass through with no userId — used
 * by read endpoints that personalize their payload (myRating, likedByMe, …)
 * when a valid token happens to be present. An invalid token is treated as
 * anonymous rather than rejected.
 */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub: string };
      req.userId = payload.sub;
    } catch {
      // anonymous
    }
  }
  next();
}
