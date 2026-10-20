import { logger } from "../logger";
import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "./directory-client";

// Used outside production. It remembers the users it was asked to make for as long as the process runs, and says in the
// log what the real client would have done, so staging and development never touch the real Workspace.
export class SimulatedDirectoryClient implements DirectoryClient {
  readonly mode = "simulated" as const;
  private readonly users = new Map<string, DirectoryUser>();
  private counter = 0;

  private byKey(userKey: string): DirectoryUser | undefined {
    return this.users.get(userKey) ?? [...this.users.values()].find((user) => user.primaryEmail === userKey);
  }

  async findUser(userKey: string): Promise<DirectoryUser | null> {
    return this.byKey(userKey) ?? null;
  }

  async findDeletedUser(): Promise<DirectoryUser | null> {
    return null;
  }

  async listUsers({ deleted }: { deleted: boolean }): Promise<DirectoryUser[]> {
    return deleted ? [] : [...this.users.values()];
  }

  async createUser(input: CreateDirectoryUser): Promise<DirectoryUser> {
    if (this.byKey(input.primaryEmail)) {
      throw new DirectoryError("EXISTS", "That email already exists in Google Workspace");
    }
    this.counter += 1;
    const user: DirectoryUser = {
      id: `simulated-${this.counter}`,
      primaryEmail: input.primaryEmail,
      givenName: input.givenName,
      familyName: input.familyName,
      suspended: false,
      isAdmin: false,
      changePasswordAtNextLogin: true,
      lastLoginTime: null,
    };
    this.users.set(user.id, user);
    logger.info(`[google simulated] would create ${input.primaryEmail}${input.recoveryEmail ? " with a recovery email" : ""}`);
    return user;
  }

  async updateUser(userKey: string, patch: UpdateDirectoryUser): Promise<DirectoryUser> {
    const user = this.byKey(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "The user does not exist in Google Workspace");
    const next = {
      ...user,
      primaryEmail: patch.primaryEmail ?? user.primaryEmail,
      givenName: patch.givenName ?? user.givenName,
      familyName: patch.familyName ?? user.familyName,
    };
    this.users.set(user.id, next);
    logger.info(`[google simulated] would update ${user.primaryEmail}`);
    return next;
  }

  async resetPassword(userKey: string): Promise<void> {
    const user = this.byKey(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "The user does not exist in Google Workspace");
    logger.info(`[google simulated] would reset the password of ${user.primaryEmail}`);
  }

  async setPhoto(userKey: string): Promise<void> {
    const user = this.byKey(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "The user does not exist in Google Workspace");
    logger.info(`[google simulated] would set the photo of ${user.primaryEmail}`);
  }
}
