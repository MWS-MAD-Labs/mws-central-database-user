import { Prisma } from "../generated/prisma/client";

export function getUniqueConstraintFields(error: unknown): string[] | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return null;
  }

  const meta = error.meta as Record<string, unknown> | undefined;
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.filter((field): field is string => typeof field === "string");
  }

  const driverAdapterError = meta?.driverAdapterError as
    | { cause?: { constraint?: { fields?: string[] } } }
    | undefined;
  return driverAdapterError?.cause?.constraint?.fields ?? null;
}
