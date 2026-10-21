import { GoogleSyncStatus, type Person } from "../generated/prisma/client";

// How long a new account may wait for its owner to set a password before it is flagged.
export const PASSWORD_PENDING_WARN_DAYS = 7;
// Google restores a deleted account for this long.
export const RESTORE_WINDOW_DAYS = 20;

// null: Google has not said. PENDING: they have not set their own password yet. OVERDUE: still not, after a week.
// SET: they have.
export function passwordStateOf(
  person: Pick<Person, "google_password_pending" | "google_password_issued_at">,
  now = new Date(),
): "PENDING" | "OVERDUE" | "SET" | null {
  if (person.google_password_pending === null || person.google_password_pending === undefined) return null;
  if (!person.google_password_pending) return "SET";
  const issued = person.google_password_issued_at;
  const waitedDays = issued ? (now.getTime() - issued.getTime()) / 86_400_000 : 0;
  return waitedDays > PASSWORD_PENDING_WARN_DAYS ? "OVERDUE" : "PENDING";
}

export type GoogleHintCode = "FAILED" | "DELETED" | "MISSING" | "SUSPENDED" | "PASSWORD_OVERDUE" | "LEFT_STILL_ACTIVE";

// `detail` carries the one fact the list needs to explain it: the error, or the last day a deleted account can come back.
export type GoogleHint = { code: GoogleHintCode; detail: string | null };

type HintPerson = Pick<
  Person,
  | "google_user_id"
  | "google_sync_status"
  | "google_last_error"
  | "google_deleted_at"
  | "google_password_pending"
  | "google_password_issued_at"
  | "google_suspended_by_central"
>;

// What is wrong with a person's Google account, for the lists. Only things that need someone to look: a person with no
// account is not a problem, and an account Central suspended because the person left is as it should be. `left` is
// whether the person resigned, finished or was archived.
export function googleHintsOf(person: HintPerson, options: { left: boolean; now?: Date }): GoogleHint[] {
  const status = person.google_sync_status;
  if (status === GoogleSyncStatus.FAILED) return [{ code: "FAILED", detail: person.google_last_error }];
  if (!person.google_user_id) return [];

  if (status === GoogleSyncStatus.MISSING) {
    if (person.google_deleted_at) {
      const until = new Date(person.google_deleted_at.getTime() + RESTORE_WINDOW_DAYS * 86_400_000);
      return [{ code: "DELETED", detail: until.toISOString() }];
    }
    return [{ code: "MISSING", detail: null }];
  }
  if (status === GoogleSyncStatus.SUSPENDED) {
    return options.left || person.google_suspended_by_central ? [] : [{ code: "SUSPENDED", detail: null }];
  }
  if (status === GoogleSyncStatus.ACTIVE) {
    const hints: GoogleHint[] = [];
    if (options.left) hints.push({ code: "LEFT_STILL_ACTIVE", detail: null });
    if (passwordStateOf(person, options.now) === "OVERDUE") hints.push({ code: "PASSWORD_OVERDUE", detail: null });
    return hints;
  }
  return [];
}
