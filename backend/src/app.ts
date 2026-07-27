import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { apiRouter } from "./routes/index.js";
import { coversRouter } from "./routes/covers.js";
import { avatarsRouter } from "./routes/avatars.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { passport } from "./config/passport.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(passport.initialize());

  app.use("/api", apiRouter);
  // Image bytes, not JSON — hence their own prefixes outside /api. Both serve
  // year-long immutable renditions; see routes/covers.ts and routes/avatars.ts.
  app.use("/covers", coversRouter);
  app.use("/avatars", avatarsRouter);
  app.use(errorHandler);
  return app;
}
