import { Router } from "express";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { searchRouter } from "./search.js";
import { releasesRouter } from "./releases.js";
import { artistsRouter } from "./artists.js";
import { labelsRouter } from "./labels.js";
import { chartsRouter } from "./charts.js";
import { ratingsRouter } from "./ratings.js";
import { logsRouter } from "./logs.js";
import { reviewsRouter, commentsRouter } from "./reviews.js";
import { listsRouter } from "./lists.js";
import { usersRouter } from "./users.js";
import { meRouter } from "./me.js";
import { feedRouter } from "./feed.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/search", searchRouter);
apiRouter.use("/releases", releasesRouter);
apiRouter.use("/artists", artistsRouter);
apiRouter.use("/labels", labelsRouter);
apiRouter.use("/charts", chartsRouter);
apiRouter.use("/ratings", ratingsRouter);
apiRouter.use("/logs", logsRouter);
apiRouter.use("/reviews", reviewsRouter);
apiRouter.use("/comments", commentsRouter);
apiRouter.use("/lists", listsRouter);
apiRouter.use("/users", usersRouter);
// The caller acting on their own account. Separate from /users/:username, which
// is the public view of somebody — see routes/me.ts.
apiRouter.use("/me", meRouter);
apiRouter.use("/feed", feedRouter);
