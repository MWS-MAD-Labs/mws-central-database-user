import { admin_directory_v1, auth } from "@googleapis/admin";
import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "./directory-client";

const SCOPES = ["https://www.googleapis.com/auth/admin.directory.user"];

type ServiceAccountKey = { client_email: string; private_key: string };

export function readServiceAccountKey(encoded: string | undefined): ServiceAccountKey {
  if (!encoded?.trim()) throw new Error("GOOGLE_WORKSPACE_CREDENTIALS_B64 is not set");
  let key: Partial<ServiceAccountKey>;
  try {
    key = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_WORKSPACE_CREDENTIALS_B64 is not base64 of the service account JSON");
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("The service account JSON has no client_email or private_key");
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

// Google says 1970 for a user who never signed in.
function loginTimeOf(value: string | null | undefined): Date | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) || time.getUTCFullYear() <= 1970 ? null : time;
}

const MAX_LIST_PAGES = 40;

const toDirectoryUser = (user: admin_directory_v1.Schema$User): DirectoryUser => ({
  id: user.id ?? "",
  primaryEmail: user.primaryEmail ?? "",
  givenName: user.name?.givenName ?? "",
  familyName: user.name?.familyName ?? "",
  suspended: Boolean(user.suspended),
  isAdmin: Boolean(user.isAdmin || user.isDelegatedAdmin),
  changePasswordAtNextLogin: Boolean(user.changePasswordAtNextLogin),
  lastLoginTime: loginTimeOf(user.lastLoginTime),
  deletionTime: user.deletionTime ? new Date(user.deletionTime) : null,
  recoveryEmail: user.recoveryEmail ?? null,
});

// Google's errors carry the HTTP status in `code`. Only the status and the reason are kept: the request body holds
// a password.
function toDirectoryError(error: unknown): DirectoryError {
  const status = Number((error as { code?: number | string })?.code);
  const reason = (error as { errors?: { reason?: string }[] })?.errors?.[0]?.reason ?? "unknown";
  if (status === 409) return new DirectoryError("EXISTS", "That email already exists in Google Workspace");
  if (status === 404) return new DirectoryError("NOT_FOUND", "The user does not exist in Google Workspace");
  if (status === 403 || status === 401) {
    return new DirectoryError("DENIED", `Google refused the request (${reason}). Check the delegation and the admin role`);
  }
  return new DirectoryError("FAILED", `Google Workspace call failed (HTTP ${Number.isNaN(status) ? "?" : status}, ${reason})`);
}

export class RealDirectoryClient implements DirectoryClient {
  readonly mode = "google" as const;
  private readonly directory: admin_directory_v1.Admin;

  constructor(key: ServiceAccountKey, subject: string) {
    const jwt = new auth.JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES, subject });
    this.directory = new admin_directory_v1.Admin({ auth: jwt });
  }

  async findUser(userKey: string): Promise<DirectoryUser | null> {
    try {
      const { data } = await this.directory.users.get({ userKey });
      return toDirectoryUser(data);
    } catch (error) {
      const mapped = toDirectoryError(error);
      if (mapped.code === "NOT_FOUND") return null;
      throw mapped;
    }
  }

  async findDeletedUser(email: string, userId?: string | null): Promise<DirectoryUser | null> {
    // The query filter does not match deleted users, so read the list: only the last 20 days of deletions are in it.
    const wanted = email.toLowerCase();
    const deleted = await this.listUsers({ deleted: true });
    return deleted.find((user) => (userId && user.id === userId) || user.primaryEmail.toLowerCase() === wanted) ?? null;
  }

  async listUsers({ deleted }: { deleted: boolean }): Promise<DirectoryUser[]> {
    const users: DirectoryUser[] = [];
    let pageToken: string | undefined;
    try {
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const { data } = await this.directory.users.list({
          customer: "my_customer",
          maxResults: 500,
          ...(deleted ? { showDeleted: "true" } : {}),
          ...(pageToken ? { pageToken } : {}),
        });
        users.push(...(data.users ?? []).map(toDirectoryUser));
        pageToken = data.nextPageToken ?? undefined;
        if (!pageToken) return users;
      }
    } catch (error) {
      throw toDirectoryError(error);
    }
    // Stopping at the cap would make users look missing that are only on a later page.
    throw new DirectoryError("FAILED", "The Workspace has more users than the list limit");
  }

  async createUser(input: CreateDirectoryUser): Promise<DirectoryUser> {
    try {
      const { data } = await this.directory.users.insert({
        requestBody: {
          primaryEmail: input.primaryEmail,
          name: { givenName: input.givenName, familyName: input.familyName },
          password: input.password,
          changePasswordAtNextLogin: true,
          ...(input.recoveryEmail ? { recoveryEmail: input.recoveryEmail } : {}),
          ...(input.orgUnitPath ? { orgUnitPath: input.orgUnitPath } : {}),
        },
      });
      return toDirectoryUser(data);
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async updateUser(userKey: string, patch: UpdateDirectoryUser): Promise<DirectoryUser> {
    try {
      const { data } = await this.directory.users.patch({
        userKey,
        requestBody: {
          ...(patch.primaryEmail ? { primaryEmail: patch.primaryEmail } : {}),
          ...(patch.givenName || patch.familyName
            ? { name: { givenName: patch.givenName, familyName: patch.familyName } }
            : {}),
        },
      });
      return toDirectoryUser(data);
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async restoreUser(userId: string, orgUnitPath: string): Promise<DirectoryUser> {
    try {
      await this.directory.users.undelete({ userKey: userId, requestBody: { orgUnitPath } });
      const { data } = await this.directory.users.get({ userKey: userId });
      return toDirectoryUser(data);
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async setRecoveryEmail(userKey: string, recoveryEmail: string): Promise<DirectoryUser> {
    try {
      const { data } = await this.directory.users.patch({ userKey, requestBody: { recoveryEmail } });
      return toDirectoryUser(data);
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async setSuspended(userKey: string, suspended: boolean): Promise<DirectoryUser> {
    try {
      const { data } = await this.directory.users.patch({ userKey, requestBody: { suspended } });
      return toDirectoryUser(data);
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async resetPassword(userKey: string, password: string): Promise<void> {
    try {
      await this.directory.users.patch({
        userKey,
        requestBody: { password, changePasswordAtNextLogin: true },
      });
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async setPhoto(userKey: string, photo: Buffer, mimeType: string): Promise<void> {
    try {
      await this.directory.users.photos.update({
        userKey,
        requestBody: {
          // The API wants web-safe base64.
          photoData: photo.toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
          mimeType,
        },
      });
    } catch (error) {
      throw toDirectoryError(error);
    }
  }

  async getPhoto(userKey: string): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const { data } = await this.directory.users.photos.get({ userKey });
      if (!data.photoData) return null;
      // The API answers in web-safe base64.
      const base64 = data.photoData.replace(/-/g, "+").replace(/_/g, "/");
      return { data: Buffer.from(base64, "base64"), mimeType: data.mimeType ?? "image/jpeg" };
    } catch (error) {
      const mapped = toDirectoryError(error);
      // A user with no photo answers 404 too.
      if (mapped.code === "NOT_FOUND") return null;
      throw mapped;
    }
  }
}
