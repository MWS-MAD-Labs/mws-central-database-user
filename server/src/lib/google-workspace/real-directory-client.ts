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

const toDirectoryUser = (user: admin_directory_v1.Schema$User): DirectoryUser => ({
  id: user.id ?? "",
  primaryEmail: user.primaryEmail ?? "",
  givenName: user.name?.givenName ?? "",
  familyName: user.name?.familyName ?? "",
  suspended: Boolean(user.suspended),
  isAdmin: Boolean(user.isAdmin || user.isDelegatedAdmin),
  changePasswordAtNextLogin: Boolean(user.changePasswordAtNextLogin),
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
}
