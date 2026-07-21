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

// Accepts 08xx, +628xx, or 628xx and always normalizes to the 62-prefixed
// form actually stored in the DB.
const normalizeIndonesianPhone = (value: string) => {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+62")) return digits.slice(1);
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
};

export const indonesianPhone = () =>
  z
    .string()
    .transform(normalizeIndonesianPhone)
    .refine(
      (val) => /^628[0-9]{7,10}$/.test(val),
      "Phone must be a valid Indonesian number (e.g. 08xx, +628xx, or 628xx)",
    );
