import { randomInt } from "node:crypto";
import {
  AuditSource,
  GoogleSyncStatus,
  IntegrationEnvironment,
  PersonType,
  type AdminUser,
  type Person,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { getDirectoryClient, testPrefix } from "../lib/google-workspace";
import { getIntegrationEnvironment } from "../utils/integration-environment";
import { DirectoryError, type DirectoryUser } from "../lib/google-workspace/directory-client";
import type { AuditRequestContext, EntityAuditAction } from "../model/audit-log-model";
import { isProtectedSuperAdminEmail } from "../utils/protected-admin";
import { emailProblem } from "../validation/validation";
import { AuditService } from "./audit-service";

// Central makes and updates the Google Workspace account behind a person's email. A person who is in Central gets an
// account in Google, so signing in with Google works for every email Central holds.

// How long a new account may wait for its owner to set a password before it is flagged.
export const PASSWORD_PENDING_WARN_DAYS = 7;
// A status read from Google this recently is shown as it is.
const STATUS_FRESH_MS = 5 * 60 * 1000;

const DELETED_MESSAGE =
  "This email belongs to a Google account that was deleted less than 20 days ago, so it cannot be reused yet. Use another address, or restore that account in the Admin Console if it is the same person";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export type GoogleSyncResult = {
  status: GoogleSyncStatus;
  google_user_id: string | null;
  // "created" a new account, "linked" one that was already there, or nothing done.
  outcome: "created" | "linked" | "updated" | "unchanged" | "failed";
  message?: string;
};

type GooglePerson = Pick<Person, "id" | "email" | "full_name" | "person_type" | "google_user_id" | "google_sync_status">;

const entityTypeOf = (person: Pick<Person, "person_type">): "Employee" | "Intern" | "Student" =>
  person.person_type === PersonType.EMPLOYEE ? "Employee" : person.person_type === PersonType.INTERN ? "Intern" : "Student";

// Google wants a given and a family name. The last word is the family name; one word gets a dash.
export function splitName(fullName: string): { givenName: string; familyName: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { givenName: words[0] ?? "-", familyName: "-" };
  return { givenName: words.slice(0, -1).join(" "), familyName: words[words.length - 1] };
}

// Used once, shown once, never stored or logged.
export function generateTemporaryPassword(length = 16): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
}

function organizationalUnitFor(person: Pick<Person, "person_type">): string | undefined {
  const key = { EMPLOYEE: "GOOGLE_OU_EMPLOYEE", INTERN: "GOOGLE_OU_INTERN", STUDENT: "GOOGLE_OU_STUDENT" }[person.person_type];
  return process.env[key]?.trim() || undefined;
}

// Only people held in Central, on the organization's domain, and never an admin account. Outside production, a client
// that talks to the real Google only takes addresses that start with GOOGLE_WORKSPACE_TEST_PREFIX, because staging and
// development share the production Workspace.
export function assertAllowedTarget(email: string): void {
  const domain = process.env.ALLOWED_DOMAIN?.trim().toLowerCase();
  if (!domain || !email.toLowerCase().endsWith(`@${domain}`)) {
    throw new ResponseError(400, "Google accounts are only made for the organization's own domain");
  }
  if (isProtectedSuperAdminEmail(email)) {
    throw new ResponseError(400, "A protected admin account is not managed from here");
  }
  const client = getDirectoryClient();
  if (client.mode === "google" && getIntegrationEnvironment() !== IntegrationEnvironment.PRODUCTION) {
    const prefix = testPrefix();
    if (!prefix || !email.toLowerCase().startsWith(prefix)) {
      throw new ResponseError(
        400,
        `Outside production only test addresses starting with "${prefix}" are sent to Google`,
      );
    }
  }
}

// What to show for a failure. Google's own errors carry their message. Anything else is ours (the database, a bug) and
// is not passed on as it is: the log has it.
function messageOf(error: unknown): string {
  if (error instanceof DirectoryError) return error.message;
  if ((error as { code?: string } | null)?.code === "P2002") {
    return "This Google account is already linked to someone else in Central";
  }
  const name = (error as { name?: string } | null)?.name;
  const code = (error as { code?: string } | null)?.code;
  const kind = [name, code].filter((part) => typeof part === "string" && /^[A-Za-z0-9_ ]{1,60}$/.test(part)).join(" ");
  return `Unexpected error${kind ? ` (${kind})` : ""} while handling the Google account, see the server log`;
}

// The Google account may already belong to another person in Central, for instance one who was archived. Linking it
// again would break the unique link, so say so instead.
async function assertNotLinkedElsewhere(googleUserId: string, personId: string): Promise<void> {
  const other = await prismaClient.person.findFirst({
    where: { google_user_id: googleUserId, NOT: { id: personId } },
    select: { full_name: true, deleted_at: true },
  });
  if (other) {
    throw new DirectoryError(
      "EXISTS",
      `This Google account is already linked to ${other.full_name}${other.deleted_at ? " (archived)" : ""} in Central. Restore that person or unlink it first`,
    );
  }
}

// What Google says about the account, kept so the page can show it without asking again.
function readingOf(user: DirectoryUser) {
  return {
    google_checked_at: new Date(),
    google_password_pending: user.changePasswordAtNextLogin,
    google_last_login_at: user.lastLoginTime,
  };
}

async function markStatus(
  personId: string,
  status: GoogleSyncStatus,
  extra: {
    google_user_id?: string | null;
    error?: string | null;
    user?: DirectoryUser;
    passwordIssued?: boolean;
  } = {},
): Promise<void> {
  await prismaClient.person.update({
    where: { id: personId },
    data: {
      google_sync_status: status,
      google_synced_at: status === GoogleSyncStatus.ACTIVE ? new Date() : undefined,
      google_last_error: extra.error ?? null,
      ...(extra.google_user_id !== undefined ? { google_user_id: extra.google_user_id } : {}),
      ...(extra.user ? readingOf(extra.user) : {}),
      ...(extra.passwordIssued ? { google_password_issued_at: new Date() } : {}),
    },
  });
}

async function record(
  action: EntityAuditAction,
  person: GooglePerson,
  admin: Pick<AdminUser, "id"> | undefined,
  context: AuditRequestContext,
  values: Record<string, string | boolean | null>,
): Promise<void> {
  const base = {
    action,
    source: AuditSource.UI,
    entity_type: entityTypeOf(person),
    entity_id: person.id,
    new_values: values,
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  };
  await AuditService.record(admin ? { ...base, admin_id: admin.id } : base)
    .catch((error) => logger.error("Google audit entry failed", error));
}

async function load(personId: string): Promise<GooglePerson> {
  const person = await prismaClient.person.findFirst({
    where: { id: personId, deleted_at: null },
    select: { id: true, email: true, full_name: true, person_type: true, google_user_id: true, google_sync_status: true },
  });
  if (!person) throw new ResponseError(404, "Person not found");
  return person;
}

export type EmailAvailability = {
  // False only when the email cannot be used for a new person.
  available: boolean;
  reason: "FREE" | "IN_CENTRAL" | "IN_GOOGLE" | "DELETED_IN_GOOGLE" | "NOT_ALLOWED" | "INVALID" | "NOT_CHECKED" | "CHECK_FAILED";
  message: string;
  mode: "google" | "simulated";
};

export class GoogleWorkspaceService {
  // Whether this email can be given to a new person: clean, on our domain, not in Central, allowed to reach Google and
  // not already a Google account. A Google that cannot be asked, or is not the real one, does not block.
  static async checkEmailAvailable(rawEmail: string): Promise<EmailAvailability> {
    const email = rawEmail.trim().toLowerCase();
    const client = getDirectoryClient();
    const answer = (reason: EmailAvailability["reason"], available: boolean, message: string): EmailAvailability => ({
      available,
      reason,
      message,
      mode: client.mode,
    });

    const problem = emailProblem(email);
    if (problem) return answer("INVALID", false, problem);
    const domain = process.env.ALLOWED_DOMAIN?.trim().toLowerCase();
    if (!domain || !email.endsWith(`@${domain}`)) {
      return answer("INVALID", false, `Email must end with @${domain}`);
    }
    if (await prismaClient.person.findFirst({ where: { email }, select: { id: true } })) {
      return answer("IN_CENTRAL", false, "This email is already used in Central");
    }
    try {
      assertAllowedTarget(email);
    } catch (error) {
      return answer("NOT_ALLOWED", false, error instanceof ResponseError ? error.message : "This email is not allowed here");
    }
    if (client.mode === "simulated") {
      return answer("NOT_CHECKED", true, "Not checked against Google in this environment");
    }
    try {
      if (await client.findUser(email)) {
        return answer("IN_GOOGLE", false, "This email already has a Google account");
      }
      // A deleted account keeps its address reserved until Google clears it.
      if (await client.findDeletedUser(email)) return answer("DELETED_IN_GOOGLE", false, DELETED_MESSAGE);
      return answer("FREE", true, "Available");
    } catch (error) {
      logger.error("Google email availability check failed", error);
      return answer("CHECK_FAILED", true, "Could not check Google, try again");
    }
  }

  // For the form that creates a person: it is not written when Google already has the email or would not take it.
  static async assertCanCreate(email: string): Promise<void> {
    const check = await this.checkEmailAvailable(email);
    if (check.reason === "IN_GOOGLE" || check.reason === "DELETED_IN_GOOGLE" || check.reason === "NOT_ALLOWED") {
      throw new ResponseError(400, check.message);
    }
  }

  // Link the account that is already in Google, or make one. Safe to run again: the lookup comes first.
  static async provision(
    personId: string,
    options: { recoveryEmail?: string; admin?: Pick<AdminUser, "id">; context?: AuditRequestContext } = {},
  ): Promise<GoogleSyncResult> {
    const person = await load(personId);
    assertAllowedTarget(person.email);
    const client = getDirectoryClient();
    await markStatus(person.id, GoogleSyncStatus.PENDING);

    try {
      let user: DirectoryUser | null = await client.findUser(person.email);
      let outcome: GoogleSyncResult["outcome"] = "linked";

      if (user?.isAdmin) {
        throw new DirectoryError("DENIED", "That email belongs to a Workspace admin, which is not managed from here");
      }
      if (!user) {
        const { givenName, familyName } = splitName(person.full_name);
        try {
          user = await client.createUser({
            primaryEmail: person.email,
            givenName,
            familyName,
            password: generateTemporaryPassword(24),
            recoveryEmail: options.recoveryEmail,
            orgUnitPath: organizationalUnitFor(person),
          });
        } catch (error) {
          // Google has no such user yet refuses the address: it is held by an account deleted not long ago.
          if (error instanceof DirectoryError && error.code === "EXISTS") {
            throw new DirectoryError("EXISTS", DELETED_MESSAGE);
          }
          throw error;
        }
        outcome = "created";
      }

      await assertNotLinkedElsewhere(user.id, person.id);
      await markStatus(person.id, GoogleSyncStatus.ACTIVE, {
        google_user_id: user.id,
        user,
        passwordIssued: outcome === "created",
      });
      await record("GOOGLE_ACCOUNT_PROVISION", person, options.admin, options.context ?? {}, {
        outcome,
        mode: client.mode,
        recovery_email_set: Boolean(options.recoveryEmail),
      });
      return { status: GoogleSyncStatus.ACTIVE, google_user_id: user.id, outcome };
    } catch (error) {
      logger.error(`Google provision failed for person ${person.id}`, error);
      const message = messageOf(error);
      await markStatus(person.id, GoogleSyncStatus.FAILED, { error: message });
      return { status: GoogleSyncStatus.FAILED, google_user_id: person.google_user_id, outcome: "failed", message };
    }
  }

  // After a person's name or email changed in Central. Does nothing for a person that has no Google account yet.
  static async syncProfile(
    personId: string,
    options: { admin?: Pick<AdminUser, "id">; context?: AuditRequestContext } = {},
  ): Promise<GoogleSyncResult> {
    const person = await load(personId);
    if (!person.google_user_id) {
      return { status: person.google_sync_status, google_user_id: null, outcome: "unchanged" };
    }
    assertAllowedTarget(person.email);
    const client = getDirectoryClient();

    try {
      const { givenName, familyName } = splitName(person.full_name);
      const user = await client.updateUser(person.google_user_id, { primaryEmail: person.email, givenName, familyName });
      await assertNotLinkedElsewhere(user.id, person.id);
      await markStatus(person.id, GoogleSyncStatus.ACTIVE, { google_user_id: user.id, user });
      await record("GOOGLE_ACCOUNT_UPDATE", person, options.admin, options.context ?? {}, { mode: client.mode });
      return { status: GoogleSyncStatus.ACTIVE, google_user_id: user.id, outcome: "updated" };
    } catch (error) {
      logger.error(`Google update failed for person ${person.id}`, error);
      const message = messageOf(error);
      await markStatus(person.id, GoogleSyncStatus.FAILED, { error: message });
      return { status: GoogleSyncStatus.FAILED, google_user_id: person.google_user_id, outcome: "failed", message };
    }
  }

  // The new password is returned once to the admin who asked. It is not stored, logged or put in the audit entry.
  static async resetPassword(
    personId: string,
    admin: Pick<AdminUser, "id">,
    context: AuditRequestContext = {},
  ): Promise<{ password: string }> {
    const person = await load(personId);
    assertAllowedTarget(person.email);
    if (!person.google_user_id) {
      throw new ResponseError(404, "This person has no Google account yet. Create it first");
    }
    const client = getDirectoryClient();
    const password = generateTemporaryPassword();

    try {
      await client.resetPassword(person.google_user_id, password);
    } catch (error) {
      logger.error(`Google password reset failed for person ${person.id}`, error);
      if (error instanceof DirectoryError && error.code === "NOT_FOUND") {
        await markStatus(person.id, GoogleSyncStatus.MISSING, { error: "Not found in Google" });
        throw new ResponseError(404, "The account is not in Google Workspace any more. Create it again");
      }
      throw new ResponseError(502, messageOf(error));
    }

    await prismaClient.person.update({
      where: { id: person.id },
      data: { google_password_pending: true, google_password_issued_at: new Date() },
    });
    await record("GOOGLE_PASSWORD_RESET", person, admin, context, { mode: client.mode });
    return { password };
  }

  // A JPEG or PNG of the person's profile photo, pushed to their Google account. A failure here is reported, the
  // photo in Central stays.
  static async setPhoto(personId: string, photo: Buffer, mimeType: string): Promise<boolean> {
    const person = await load(personId);
    if (!person.google_user_id) return false;
    try {
      await getDirectoryClient().setPhoto(person.google_user_id, photo, mimeType);
      return true;
    } catch (error) {
      logger.error(`Google photo update failed for person ${person.id}`, error);
      return false;
    }
  }

  // Ask Google how a linked account is doing and keep the answer. It only reads: nothing in Google is changed, and
  // nothing in Central is blocked by the result. A Google that cannot be reached leaves the last answer as it was.
  static async refreshStatus(personId: string): Promise<void> {
    const person = await load(personId);
    if (!person.google_user_id || person.google_sync_status === GoogleSyncStatus.PENDING) return;
    const client = getDirectoryClient();
    // The simulated Google forgets its users when the process restarts, so it cannot say who is missing.
    if (client.mode === "simulated") return;
    try {
      assertAllowedTarget(person.email);
    } catch {
      return;
    }

    try {
      const user = await client.findUser(person.google_user_id);
      if (user) {
        const suspended = user.suspended;
        await markStatus(person.id, suspended ? GoogleSyncStatus.SUSPENDED : GoogleSyncStatus.ACTIVE, {
          user,
          error: suspended ? "Suspended in Google" : null,
        });
        return;
      }
      const deleted = await client.findDeletedUser(person.email);
      await markStatus(person.id, GoogleSyncStatus.MISSING, {
        error: deleted ? "Deleted in Google, can be restored for about 20 days" : "Not found in Google",
      });
      await prismaClient.person.update({
        where: { id: person.id },
        data: { google_checked_at: new Date(), google_password_pending: null },
      });
    } catch (error) {
      logger.error(`Google status check failed for person ${person.id}`, error);
    }
  }

  // Checks every linked account with two list calls instead of one call per person. Returns how many changed.
  static async refreshAllStatuses(): Promise<number> {
    const client = getDirectoryClient();
    if (client.mode === "simulated") return 0;
    const linked = await prismaClient.person.findMany({
      where: {
        deleted_at: null,
        google_user_id: { not: null },
        google_sync_status: { not: GoogleSyncStatus.PENDING },
      },
      select: { id: true, email: true, google_user_id: true, google_sync_status: true },
    });
    if (linked.length === 0) return 0;

    const [active, deleted] = await Promise.all([client.listUsers({ deleted: false }), client.listUsers({ deleted: true })]);
    const activeById = new Map(active.map((user) => [user.id, user]));
    const deletedIds = new Set(deleted.map((user) => user.id));

    let changed = 0;
    for (const person of linked) {
      try {
        assertAllowedTarget(person.email);
      } catch {
        continue;
      }
      const user = activeById.get(person.google_user_id as string);
      let status: GoogleSyncStatus;
      let error: string | null = null;
      if (user) {
        status = user.suspended ? GoogleSyncStatus.SUSPENDED : GoogleSyncStatus.ACTIVE;
        if (user.suspended) error = "Suspended in Google";
      } else {
        status = GoogleSyncStatus.MISSING;
        error = deletedIds.has(person.google_user_id as string)
          ? "Deleted in Google, can be restored for about 20 days"
          : "Not found in Google";
      }
      if (status !== person.google_sync_status) changed += 1;
      await markStatus(person.id, status, { error, ...(user ? { user } : {}) });
      if (!user) {
        await prismaClient.person.update({ where: { id: person.id }, data: { google_password_pending: null } });
      }
    }
    return changed;
  }

  // `refresh` forces a new look at Google. Without it Google is asked only when the last look is more than a few
  // minutes old, so opening a page keeps the status honest.
  static async statusOf(personId: string, options: { refresh?: boolean } = {}) {
    const read = () =>
      prismaClient.person.findFirst({
        where: { id: personId, deleted_at: null },
        select: {
          google_user_id: true,
          google_sync_status: true,
          google_synced_at: true,
          google_last_error: true,
          google_checked_at: true,
          google_password_pending: true,
          google_password_issued_at: true,
          google_last_login_at: true,
        },
      });
    let person = await read();
    if (!person) throw new ResponseError(404, "Person not found");
    const stale = !person.google_checked_at || Date.now() - person.google_checked_at.getTime() > STATUS_FRESH_MS;
    if (person.google_user_id && (options.refresh || stale)) {
      await this.refreshStatus(personId);
      person = (await read()) ?? person;
    }
    return {
      linked: Boolean(person.google_user_id),
      status: person.google_sync_status,
      synced_at: person.google_synced_at ? person.google_synced_at.toISOString() : null,
      checked_at: person.google_checked_at ? person.google_checked_at.toISOString() : null,
      last_error: person.google_last_error,
      password_state: passwordStateOf(person),
      password_issued_at: person.google_password_issued_at ? person.google_password_issued_at.toISOString() : null,
      last_login_at: person.google_last_login_at ? person.google_last_login_at.toISOString() : null,
      mode: getDirectoryClient().mode,
    };
  }
}

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
