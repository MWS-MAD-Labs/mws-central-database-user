import { EmployeeStatus, GoogleSyncStatus, InternStatus, PersonType, StudentStatus } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { getDirectoryClient } from "../lib/google-workspace";
import type { DirectoryUser } from "../lib/google-workspace/directory-client";
import { prismaClient } from "../lib/prisma";
import { isProtectedSuperAdminEmail } from "../utils/protected-admin";
import { assertAllowedTarget, lockOf, nameKey } from "./google-workspace-service";

const LIMIT = 200;
const CACHE_MS = 60_000;

export type ReconcileRow = {
  person_id: string | null;
  type: "Employee" | "Intern" | "Student" | "Google";
  name: string;
  email: string;
  detail: string;
  // The account was claimed with its own name, so a different name in Google is expected.
  keeps_name?: boolean;
};
export type ReconcileGroup = { count: number; rows: ReconcileRow[]; truncated: boolean };

export type ReconcileGroupName =
  | "only_in_central"
  | "only_in_google"
  | "not_linked"
  | "email_differs"
  | "name_differs"
  | "should_be_suspended"
  | "suspended_in_google"
  | "link_broken";

export type ReconcileReport = {
  generated_at: string;
  central_people: number;
  google_users: number;
  groups: Record<ReconcileGroupName, ReconcileGroup>;
};

let cache: { at: number; report: ReconcileReport } | null = null;

export function resetReconcileCacheForTests(): void {
  cache = null;
}

const TYPE_LABEL = { [PersonType.EMPLOYEE]: "Employee", [PersonType.INTERN]: "Intern", [PersonType.STUDENT]: "Student" } as const;

// How Central and Google stand against each other, person by person and account by account. Only reads: nothing is
// written to Google or to Central. Workspace admins, protected admin addresses, addresses outside the organization's
// domain or that Central may not reach from here, and links made by the simulated Google are left out.
export class GoogleReconcileService {
  static async run(): Promise<ReconcileReport> {
    const client = getDirectoryClient();
    if (client.mode === "simulated") {
      throw new ResponseError(400, "Reconciling needs the real Google. This environment only simulates it");
    }
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.report;

    const domain = process.env.ALLOWED_DOMAIN?.trim().toLowerCase() ?? "";
    const [people, users] = await Promise.all([
      prismaClient.person.findMany({
        where: { person_type: { in: [PersonType.EMPLOYEE, PersonType.INTERN, PersonType.STUDENT] } },
        select: {
          id: true,
          email: true,
          full_name: true,
          person_type: true,
          google_user_id: true,
          google_sync_status: true,
          google_keeps_name: true,
          deleted_at: true,
          employee: { select: { status: true, deleted_at: true } },
          intern: { select: { status: true, deleted_at: true } },
          student: { select: { status: true, deleted_at: true, nis: true, legacy_nis: true } },
        },
        orderBy: { full_name: "asc" },
      }),
      client.listUsers({ deleted: false }),
    ]);

    const empty = (): ReconcileGroup => ({ count: 0, rows: [], truncated: false });
    const groups: Record<ReconcileGroupName, ReconcileGroup> = {
      only_in_central: empty(),
      only_in_google: empty(),
      not_linked: empty(),
      email_differs: empty(),
      name_differs: empty(),
      should_be_suspended: empty(),
      suspended_in_google: empty(),
      link_broken: empty(),
    };
    const add = (name: ReconcileGroupName, row: ReconcileRow) => {
      const group = groups[name];
      group.count += 1;
      if (group.rows.length < LIMIT) group.rows.push(row);
      else group.truncated = true;
    };

    const byId = new Map<string, DirectoryUser>(users.map((user) => [user.id, user]));
    const byEmail = new Map<string, DirectoryUser>(users.map((user) => [user.primaryEmail.toLowerCase(), user]));
    const personEmails = new Set(people.map((person) => person.email.toLowerCase()));
    const matched = new Set<string>();

    for (const person of people) {
      const email = person.email.toLowerCase();
      if (isProtectedSuperAdminEmail(email) || person.google_user_id?.startsWith("simulated-")) continue;
      try {
        assertAllowedTarget(email);
      } catch {
        continue;
      }
      const row = (detail: string): ReconcileRow => ({
        person_id: person.id,
        type: TYPE_LABEL[person.person_type as keyof typeof TYPE_LABEL],
        name: person.full_name,
        email: person.email,
        detail,
        ...(person.google_keeps_name ? { keeps_name: true } : {}),
      });
      const lock = lockOf(person);

      if (person.google_user_id) {
        const user = byId.get(person.google_user_id);
        if (!user) {
          add("link_broken", row("Linked, but Google has no such account"));
          continue;
        }
        matched.add(user.id);
        if (user.isAdmin) continue;
        if (user.primaryEmail.toLowerCase() !== email) add("email_differs", row(`Google has ${user.primaryEmail}`));
        if (nameKey(`${user.givenName} ${user.familyName}`) !== nameKey(person.full_name)) {
          add("name_differs", row(`Google has ${`${user.givenName} ${user.familyName}`.trim()}`));
        }
        if (lock.locked && !user.suspended) add("should_be_suspended", row(`Left (${lock.reason}), account still active`));
        if (!lock.locked && user.suspended) add("suspended_in_google", row("Active here, suspended in Google"));
        continue;
      }

      // No link. Someone waiting to claim an account is expected to have none yet.
      if (person.google_sync_status === GoogleSyncStatus.PENDING_CLAIM) continue;
      const user = byEmail.get(email);
      if (user) {
        matched.add(user.id);
        if (!user.isAdmin) add("not_linked", row("The email is a Google account that is not linked"));
        continue;
      }
      if (lock.locked || person.deleted_at) continue;
      const legacyStudent = person.student && (person.student.legacy_nis || !person.student.nis);
      const shouldHave =
        (person.employee && person.employee.status === EmployeeStatus.ACTIVE) ||
        (person.intern && person.intern.status === InternStatus.ACTIVE) ||
        (person.student &&
          !legacyStudent &&
          (person.student.status === StudentStatus.ACTIVE || person.student.status === StudentStatus.REGISTERED));
      if (shouldHave) add("only_in_central", row("No Google account for this email"));
    }

    for (const user of users) {
      const email = user.primaryEmail.toLowerCase();
      if (user.isAdmin || matched.has(user.id) || personEmails.has(email)) continue;
      if (!domain || !email.endsWith(`@${domain}`) || isProtectedSuperAdminEmail(email)) continue;
      try {
        assertAllowedTarget(email);
      } catch {
        continue;
      }
      add("only_in_google", {
        person_id: null,
        type: "Google",
        name: `${user.givenName} ${user.familyName}`.trim(),
        email: user.primaryEmail,
        detail: user.suspended ? "Suspended, nobody in Central has this email" : "Nobody in Central has this email",
      });
    }

    const report: ReconcileReport = {
      generated_at: new Date().toISOString(),
      central_people: people.length,
      google_users: users.length,
      groups,
    };
    cache = { at: Date.now(), report };
    return report;
  }
}
