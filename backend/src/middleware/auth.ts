import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "./errorHandler.js";
import { isUserDenied } from "../services/tokenDenylist.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

// Both guards became ASYNC in 6.2b step 6, when the token denylist was added
// (see services/tokenDenylist.ts for why a deleted account's token must stop
// working before it expires).
//
// That change carries a §6 trap worth naming, because it is invisible in a
// green suite: Express 4 catches a SYNCHRONOUS throw out of middleware and
// routes it to errorHandler, and does NOT catch a rejected promise. The moment
// these functions gained an `await`, every `throw` in them became an unhandled
// rejection — a 401 that never reaches the client, a request that hangs until
// it times out, and no error anywhere. That is the same "no error anywhere"
// symptom class the day-one rating bug taught us to distrust.
//
// So every failure path here routes through `next(err)` explicitly, and `next()`
// is called exactly once, OUTSIDE the try — calling it inside would let a
// downstream synchronous throw re-enter this catch and produce a second
// `next(err)` on a request whose headers may already be sent.

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  let userId: string;
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing access token");
    let payload: { sub: string };
    try {
      payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub: string };
    } catch {
      throw new HttpError(401, "Invalid or expired access token");
    }
    // A signature that verifies is not proof the account still exists. The
    // message deliberately does not distinguish a deleted account from an
    // expired token: there is nobody left for whom that distinction is useful,
    // and it would confirm to a third party holding a stolen token that the
    // account was deleted rather than merely logged out.
    if (await isUserDenied(payload.sub)) {
      throw new HttpError(401, "Invalid or expired access token");
    }
    userId = payload.sub;
  } catch (err) {
    next(err);
    return;
  }
  req.userId = userId;
  next();
}

/**
 * Like requireAuth, but anonymous requests pass through with no userId — used
 * by read endpoints that personalize their payload (myRating, likedByMe, …)
 * when a valid token happens to be present. An invalid token is treated as
 * anonymous rather than rejected.
 *
 * A denied token is likewise treated as anonymous rather than rejected, which
 * is the correct shape here: these endpoints answer for signed-out visitors
 * anyway, so the response degrades to the public one instead of failing.
 */
export async function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub: string };
      if (!(await isUserDenied(payload.sub))) req.userId = payload.sub;
    } catch {
      // anonymous
    }
  }
  next();
}
