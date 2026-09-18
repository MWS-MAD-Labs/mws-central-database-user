import { z, ZodType } from "zod";

export class Validation {
  static validate<T>(schema: ZodType<T>, data: T): T {
    return schema.parse(data);
  }
}

// Store emails lowercase because the database comparison is case-sensitive.
export const emailWithAllowedDomain = () =>
  z
    .email("Invalid email format")
    .min(1, "Email is required")
    .max(50, "Email is too long")
    .toLowerCase()
    .refine(
      (email) => email.endsWith(`@${process.env.ALLOWED_DOMAIN!}`),
      "Email must use an allowed organization domain",
    );

// Normalize Indonesian mobile numbers to the stored 62-prefixed form.
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
    .superRefine((val, ctx) => {
      if (!/^\d+$/.test(val)) {
        ctx.addIssue({
          code: "custom",
          message:
            "Phone must contain only digits (e.g. 08xx, +628xx, or 628xx).",
        });
        return;
      }
      if (!val.startsWith("628")) {
        ctx.addIssue({
          code: "custom",
          message:
            "Phone must be an Indonesian mobile number starting with 08, +628, or 628.",
        });
        return;
      }
      if (val.length < 10 || val.length > 15) {
        const problem = val.length < 10 ? "too short" : "too long";
        ctx.addIssue({
          code: "custom",
          message: `Phone number is ${problem} - Indonesian mobile numbers are usually 10-15 digits (e.g. 08123456789).`,
        });
      }
    });

const titleCaseWord = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

const titleCaseHyphenated = (word: string) =>
  word.split("-").map(titleCaseWord).join("-");

const normalizePersonName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(titleCaseHyphenated)
    .join(" ");

export const personName = (maxLength = 100) =>
  z
    .string()
    .min(1, "Full name is required")
    .max(maxLength, "Full name is too long")
    .transform(normalizePersonName);

// These broad bounds reject obvious date-entry errors, not edge cases.
export const MAX_BIRTH_DATE_AGE_YEARS = 130;
export const MAX_JOIN_DATE_FUTURE_DAYS = 90;
export const MAX_FUTURE_DATE_YEARS = 50;

export function isBirthDateNotFuture(iso: string): boolean {
  return new Date(iso) <= new Date();
}

export function isBirthDateNotTooOld(iso: string): boolean {
  const floor = new Date();
  floor.setFullYear(floor.getFullYear() - MAX_BIRTH_DATE_AGE_YEARS);
  return new Date(iso) >= floor;
}

export function isWithinJoinDateFutureCap(iso: string): boolean {
  const cap = new Date();
  cap.setDate(cap.getDate() + MAX_JOIN_DATE_FUTURE_DAYS);
  return new Date(iso) <= cap;
}

export function isWithinReasonableFutureCeiling(iso: string): boolean {
  const cap = new Date();
  cap.setFullYear(cap.getFullYear() + MAX_FUTURE_DATE_YEARS);
  return new Date(iso) <= cap;
}

// Calculate completed years, accounting for month and day.
export function yearsBetweenDates(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  let years = to.getFullYear() - from.getFullYear();
  const monthDiff = to.getMonth() - from.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && to.getDate() < from.getDate())) {
    years--;
  }
  return years;
}
