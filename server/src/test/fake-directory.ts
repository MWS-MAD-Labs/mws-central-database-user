import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "../lib/google-workspace/directory-client";

// A Google that lives in memory and remembers what it was asked.
export class FakeDirectory implements DirectoryClient {
  readonly mode = "google" as const;
  users = new Map<string, DirectoryUser>();
  created: CreateDirectoryUser[] = [];
  updated: { userKey: string; patch: UpdateDirectoryUser }[] = [];
  passwords: { userKey: string; password: string }[] = [];
  photos: { userKey: string; mimeType: string; size: number }[] = [];
  failCreateWith: DirectoryError | null = null;
  // Users deleted in Google that can still be restored.
  deleted = new Map<string, DirectoryUser>();
  restored: { userId: string; orgUnitPath: string }[] = [];

  async findUser(userKey: string) {
    return [...this.users.values()].find((user) => user.id === userKey || user.primaryEmail === userKey) ?? null;
  }
  async findDeletedUser(email: string, userId?: string | null) {
    return [...this.deleted.values()].find((user) => user.primaryEmail === email || (userId && user.id === userId)) ?? null;
  }
  async listUsers({ deleted }: { deleted: boolean }) {
    return [...(deleted ? this.deleted : this.users).values()];
  }
  async createUser(input: CreateDirectoryUser) {
    // The address of a deleted account is still taken.
    if ([...this.deleted.values()].some((user) => user.primaryEmail === input.primaryEmail)) {
      throw new DirectoryError("EXISTS", "exists");
    }
    if (this.failCreateWith) throw this.failCreateWith;
    this.created.push(input);
    const user: DirectoryUser = {
      id: `g-${this.created.length}`,
      primaryEmail: input.primaryEmail,
      givenName: input.givenName,
      familyName: input.familyName,
      suspended: false,
      isAdmin: false,
      changePasswordAtNextLogin: true, lastLoginTime: null,
      recoveryEmail: input.recoveryEmail ?? null,
    };
    this.users.set(user.id, user);
    return user;
  }
  async updateUser(userKey: string, patch: UpdateDirectoryUser) {
    this.updated.push({ userKey, patch });
    const user = await this.findUser(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    const next = { ...user, ...patch };
    this.users.set(user.id, next);
    return next;
  }
  async restoreUser(userId: string, orgUnitPath: string) {
    const user = this.deleted.get(userId);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    this.deleted.delete(userId);
    this.restored.push({ userId, orgUnitPath });
    this.users.set(userId, user);
    return user;
  }
  async setRecoveryEmail(userKey: string, recoveryEmail: string) {
    const user = await this.findUser(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    const next = { ...user, recoveryEmail };
    this.users.set(user.id, next);
    return next;
  }
  async setSuspended(userKey: string, suspended: boolean) {
    const user = await this.findUser(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    const next = { ...user, suspended };
    this.users.set(user.id, next);
    return next;
  }
  async resetPassword(userKey: string, password: string) {
    if (!(await this.findUser(userKey))) throw new DirectoryError("NOT_FOUND", "gone");
    this.passwords.push({ userKey, password });
  }
  async setPhoto(userKey: string, photo: Buffer, mimeType: string) {
    this.photos.push({ userKey, mimeType, size: photo.length });
  }
  // Photos a test puts in Google, by user key.
  googlePhotos = new Map<string, Buffer>();
  async getPhoto(userKey: string) {
    const data = this.googlePhotos.get(userKey);
    return data ? { data, mimeType: "image/jpeg" } : null;
  }
}
