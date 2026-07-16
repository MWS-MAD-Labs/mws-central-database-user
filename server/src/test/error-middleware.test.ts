import { describe, it, expect } from "bun:test";
import type { Context } from "hono";
import { Prisma } from "../generated/prisma/client";
import { errorMiddleware } from "../middleware/error-middleware";

function createMockContext() {
  let jsonBody: unknown;
  let jsonStatus: number | undefined;

  const context = {
    req: { method: "POST", path: "/api/admin/employees" },
    json: (body: unknown, status?: number) => {
      jsonBody = body;
      jsonStatus = status;
      return new Response(JSON.stringify(body), { status });
    },
  } as unknown as Context;

  return {
    context,
    getResult: () => ({
      body: jsonBody as { errors: string },
      status: jsonStatus,
    }),
  };
}

describe("errorMiddleware Prisma error mapping", () => {
  it("maps P2002 unique constraint on email to a clean 400 (driver adapter meta shape)", async () => {
    const { context, getResult } = createMockContext();
    const err = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "test",
        meta: {
          driverAdapterError: {
            cause: { constraint: { fields: ["email"] } },
          },
        },
      },
    );

    await errorMiddleware(err, context);
    const { body, status } = getResult();

    expect(status).toBe(400);
    expect(body.errors).toBe("Email already registered");
  });

  it("maps P2002 unique constraint on employee_id to a clean 400 (driver adapter meta shape)", async () => {
    const { context, getResult } = createMockContext();
    const err = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "test",
        meta: {
          driverAdapterError: {
            cause: { constraint: { fields: ["employee_id"] } },
          },
        },
      },
    );

    await errorMiddleware(err, context);
    const { body, status } = getResult();

    expect(status).toBe(400);
    expect(body.errors).toBe("Employee ID already registered");
  });

  it("also supports the classic meta.target shape for P2002", async () => {
    const { context, getResult } = createMockContext();
    const err = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["email"] },
      },
    );

    await errorMiddleware(err, context);
    const { body, status } = getResult();

    expect(status).toBe(400);
    expect(body.errors).toBe("Email already registered");
  });

  it("maps P2003 foreign key violation on unit_id to a clean 400 (driver adapter meta shape)", async () => {
    const { context, getResult } = createMockContext();
    const err = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed",
      {
        code: "P2003",
        clientVersion: "test",
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: "employees_unit_id_fkey" } },
          },
        },
      },
    );

    await errorMiddleware(err, context);
    const { body, status } = getResult();

    expect(status).toBe(400);
    expect(body.errors).toContain("Invalid unit");
  });

  it("falls back to a generic message for an unmapped Prisma error code", async () => {
    const { context, getResult } = createMockContext();
    const err = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "test",
    });

    await errorMiddleware(err, context);
    const { body, status } = getResult();

    expect(status).toBe(500);
    expect(body.errors).toBe("Internal Server Error");
  });
});
