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
import { AuditService } from "./audit-service";

// Central makes and updates the Google Workspace account behind a person's email. A person who is in Central gets an
// account in Google, so signing in with Google works for every email Central holds.

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

function messageOf(error: unknown): string {
  if (error instanceof DirectoryError) return error.message;
  return "Google Workspace could not be reached";
}

async function markStatus(
  personId: string,
  status: GoogleSyncStatus,
  extra: { google_user_id?: string | null; error?: string | null } = {},
): Promise<void> {
  await prismaClient.person.update({
    where: { id: personId },
    data: {
      google_sync_status: status,
      google_synced_at: status === GoogleSyncStatus.ACTIVE ? new Date() : undefined,
      google_last_error: extra.error ?? null,
      ...(extra.google_user_id !== undefined ? { google_user_id: extra.google_user_id } : {}),
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

export class GoogleWorkspaceService {
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
        user = await client.createUser({
          primaryEmail: person.email,
          givenName,
          familyName,
          password: generateTemporaryPassword(24),
          recoveryEmail: options.recoveryEmail,
          orgUnitPath: organizationalUnitFor(person),
        });
        outcome = "created";
      }

      await markStatus(person.id, GoogleSyncStatus.ACTIVE, { google_user_id: user.id });
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
      await markStatus(person.id, GoogleSyncStatus.ACTIVE, { google_user_id: user.id });
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
        await markStatus(person.id, GoogleSyncStatus.FAILED, { error: error.message });
        throw new ResponseError(404, "The account is not in Google Workspace any more. Create it again");
      }
      throw new ResponseError(502, messageOf(error));
    }

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

  static async statusOf(personId: string) {
    const person = await prismaClient.person.findFirst({
      where: { id: personId, deleted_at: null },
      select: { google_user_id: true, google_sync_status: true, google_synced_at: true, google_last_error: true },
    });
    if (!person) throw new ResponseError(404, "Person not found");
    return {
      linked: Boolean(person.google_user_id),
      status: person.google_sync_status,
      synced_at: person.google_synced_at ? person.google_synced_at.toISOString() : null,
      last_error: person.google_last_error,
      mode: getDirectoryClient().mode,
    };
  }
}
