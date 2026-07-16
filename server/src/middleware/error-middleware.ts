import type { Context } from "hono";
import { ZodError } from "zod";
import { ResponseError } from "../error/response-error";
import { logger } from "../lib/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Prisma } from "../generated/prisma/client";

const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  email: "Email already registered",
  employee_id: "Employee ID already registered",
};

const FOREIGN_KEY_FIELD_LABELS: Record<string, string> = {
  unit_id: "unit",
  job_position_id: "job position",
  job_level_id: "job level",
};

function getDriverAdapterConstraint(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const driverAdapterError = meta?.driverAdapterError as
    | { cause?: { constraint?: Record<string, unknown> } }
    | undefined;
  return driverAdapterError?.cause?.constraint;
}

function extractUniqueFields(
  meta: Record<string, unknown> | undefined,
): string[] {
  const target = meta?.target ?? getDriverAdapterConstraint(meta)?.fields;
  const fields = Array.isArray(target) ? target : [target].filter(Boolean);
  return fields.filter((field): field is string => typeof field === "string");
}

function extractForeignKeyConstraintName(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const fieldName =
    meta?.field_name ?? getDriverAdapterConstraint(meta)?.index;
  return typeof fieldName === "string" ? fieldName : undefined;
}

function describeUniqueConstraint(meta: Record<string, unknown> | undefined) {
  const fields = extractUniqueFields(meta);

  for (const field of fields) {
    if (UNIQUE_FIELD_MESSAGES[field]) {
      return UNIQUE_FIELD_MESSAGES[field];
    }
  }
  return `${fields.join(", ") || "Value"} already exists`;
}

function describeForeignKeyConstraint(
  meta: Record<string, unknown> | undefined,
) {
  const constraintName = extractForeignKeyConstraintName(meta);
  if (constraintName) {
    const matchedKey = Object.keys(FOREIGN_KEY_FIELD_LABELS).find((key) =>
      constraintName.includes(key),
    );
    if (matchedKey) {
      return `Invalid ${FOREIGN_KEY_FIELD_LABELS[matchedKey]}: referenced record does not exist`;
    }
  }
  return "Invalid reference: related record does not exist";
}

export const errorMiddleware = async (err: Error, c: Context) => {
  if (err instanceof ZodError) {
    return c.json({ errors: err.issues.map((i) => i.message).join(", ") }, 400);
  } else if (err instanceof ResponseError) {
    return c.json({ errors: err.message }, err.status as ContentfulStatusCode);
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return c.json({ errors: describeUniqueConstraint(err.meta) }, 400);
    }
    if (err.code === "P2003") {
      return c.json({ errors: describeForeignKeyConstraint(err.meta) }, 400);
    }

    logger.error("Unhandled Prisma error", {
      code: err.code,
      meta: err.meta,
      method: c.req.method,
      path: c.req.path,
    });
    return c.json({ errors: "Internal Server Error" }, 500);
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
