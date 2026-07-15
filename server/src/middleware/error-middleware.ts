import type { Context } from "hono";
import { ZodError } from "zod";
import { ResponseError } from "../error/response-error";
import { logger } from "../lib/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const errorMiddleware = async (err: Error, c: Context) => {
  if (err instanceof ZodError) {
    return c.json({ errors: err.issues.map((i) => i.message).join(", ") }, 400);
  } else if (err instanceof ResponseError) {
    return c.json({ errors: err.message }, err.status as ContentfulStatusCode);
  } else {
    logger.error("Unhandled error", {
      message: err.message,
      stack: err.stack,
      method: c.req.method,
      path: c.req.path,
    });
    return c.json({ errors: "Internal Server Error" }, 500);
  }
};
