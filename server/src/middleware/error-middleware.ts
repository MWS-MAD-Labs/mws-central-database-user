import type { Context } from "hono";
import { ZodError } from "zod";
import { ResponseError } from "../error/response-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const errorMiddleware = async (err: Error, c: Context) => {
  if (err instanceof ZodError) {
    return c.json(
      { errors: `Validation Error : ${JSON.stringify(err)}` },
      400,
    );
  } else if (err instanceof ResponseError) {
    return c.json(
      { errors: err.message },
      err.status as ContentfulStatusCode,
    );
  } else {
    return c.json({ errors: err.message }, 500);
  }
};
