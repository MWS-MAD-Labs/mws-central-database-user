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

// Split into separate checks (rather than one regex + one generic message)
// so the error actually says what's wrong - a 19-digit paste-in mistake and
// a landline number both used to get the same unhelpful "invalid Indonesian
// number" with no indication of which part failed or why.
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

// 50 was too tight for real names - Balinese naming (multiple honorific/
// ancestral-title components), long Arabic/Indian compound names, etc.
// routinely run well past it. This isn't a format constraint like NIS/
// phone (no lookup logic depends on the exact length), so there's no
// reason to keep it strict - just give it real headroom instead of
// building a legacy-name fallback field.
export const personName = (maxLength = 100) =>
  z
    .string()
    .min(1, "Full name is required")
    .max(maxLength, "Full name is too long")
    .transform(normalizePersonName);

// Shared date-sanity bounds - catches fat-finger typos (birth year 2200,
// join year 1200) that ISO-format validation alone lets straight through.
// Kept generous on purpose: these are "obviously impossible" guards, not
// tight business rules, so real edge cases (old-timer staff, pre-boarding a
// few months out) never trip them. 130 (not 120) is deliberate - it clears
// import-service.ts's "1900-01-01" sentinel default for a legacy row with
// no real birth date on the sheet, with margin to spare.
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

// Whole years elapsed between two ISO dates - not a naive year subtraction,
// so someone born Dec 2008 isn't counted as 18 the moment the calendar
// flips to 2026 in January.
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
