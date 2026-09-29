import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { errorMiddleware } from "../middleware/error-middleware";
import { apiRouter } from "../routes/api-router";

export const web = new Hono();

web.use("*", secureHeaders());
web.use("*", logger());

// Without this, a browser can serve a stale GET response from its own HTTP
// cache for an identical URL (no Cache-Control/ETag/Last-Modified means the
// browser is free to reuse it) - e.g. a class's "assign teacher" list
// showing stale data after creating a new employee, even after the app's
// own refresh button forces a fresh fetch that the browser then serves from
// cache instead of the network. Every /api response is per-request admin
// data, never safe to cache.
web.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:5173", "http://localhost:4173"];

web.use(
  "*",
  cors({
    origin: (origin) => {
      return allowedOrigins.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Accept"],
  }),
);

web.use(
  "*",
  csrf({
    origin: allowedOrigins,
  }),
);
web.route("/api", apiRouter);

web.onError(errorMiddleware);
