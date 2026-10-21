import { z, ZodType } from "zod";

export class Validation {
  static validate<T>(schema: ZodType<T>, data: T): T {
    return schema.parse(data);
  }
}

// One rule for every email Central stores: before the @ only lowercase letters, digits and the separators . _ -, and a
// separator never starts, ends or doubles up. So no + % ' ! or spaces. The domain is an ordinary domain name.
const CLEAN_LOCAL_PART = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
// An address at someone else's provider (a parent, a recovery email) may also carry a +label, which Gmail and others
// deliver to the plain mailbox. A Google Workspace account name of ours may not.
const CLEAN_EXTERNAL_LOCAL_PART = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/;
const CLEAN_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

// What is wrong with an email, in plain words, or null when it is fine. Expects the lowercase form.
export function emailProblem(email: string, options: { external?: boolean } = {}): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "Invalid email format";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!(options.external ? CLEAN_EXTERNAL_LOCAL_PART : CLEAN_LOCAL_PART).test(local)) {
    return options.external
      ? "Email can only use letters, numbers, dots, underscores, hyphens and + before the @"
      : "Email can only use letters, numbers, dots, underscores and hyphens before the @";
  }
  if (!CLEAN_DOMAIN.test(domain)) return "Invalid email domain";
  return null;
}

// An email at someone else's provider (parents, recovery): lowercase, trimmed, and clean.
export const cleanEmail = () =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(100, "Email is too long")
    .superRefine((email, context) => {
      const problem = emailProblem(email, { external: true });
      if (problem) context.addIssue({ code: "custom", message: problem });
    });

// Store emails lowercase because the database comparison is case-sensitive.
export const emailWithAllowedDomain = () =>
  z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(50, "Email is too long")
    .superRefine((email, context) => {
      const problem = emailProblem(email);
      if (problem) context.addIssue({ code: "custom", message: problem });
    })
    .refine(
      (email) => email.endsWith(`@${process.env.ALLOWED_DOMAIN!}`),
      "Email must use an allowed organization domain",
    );

// Where Google sends the code when someone forgets the password of a new account. Any clean address, including another
// mailbox of the organization; only the account's own address is refused (see assertRecoveryIsNotOwn). It goes to Google
// and is not kept in Central.
export const recoveryEmail = () => cleanEmail();

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
