import { z, ZodType } from "zod";

export class Validation {
  static validate<T>(schema: ZodType<T>, data: T): T {
    return schema.parse(data);
  }
}

export const emailWithAllowedDomain = () =>
  z
    .email("Invalid email format")
    .min(1, "Email is required")
    .max(50, "Email is too long")
    .refine(
      (email) => email.endsWith(`@${process.env.ALLOWED_DOMAIN!}`),
      "Email must use an allowed organization domain",
    );
