import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { errorMiddleware } from "../middleware/error-middleware";
import { publicRouter } from "../routes/public-api";
import { adminRouter } from "../routes/admin-api";
import { internalRouter } from "../routes/internal-api";

export const web = new Hono();

web.use("*", secureHeaders());
web.use("*", logger());

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
];

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

web.route("/", publicRouter);
web.route("/", adminRouter);
web.route("/", internalRouter);

web.onError(errorMiddleware);
