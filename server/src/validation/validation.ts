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
export const normalizeIndonesianPhone = (value: string) => {
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

const titleCaseWord = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

// Title-cases each hyphen segment too, so hyphenated names like "nur-aini"
// normalize to "Nur-Aini" instead of "Nur-aini".
const titleCaseHyphenated = (word: string) =>
  word.split("-").map(titleCaseWord).join("-");

// Trims, collapses inner whitespace, and title-cases each word so
// "jane doe", "JANE DOE", and "jane  doe" all normalize to "Jane Doe".
const normalizePersonName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(titleCaseHyphenated)
    .join(" ");

export const personName = (maxLength = 50) =>
  z
    .string()
    .min(1, "Full name is required")
    .max(maxLength, "Full name is too long")
    .transform(normalizePersonName);
