// What Central needs from the Google Workspace Directory API, and nothing more. The real client talks to Google, the
// simulated one is used everywhere but production, and tests bring their own.
export type DirectoryUser = {
  id: string;
  primaryEmail: string;
  givenName: string;
  familyName: string;
  suspended: boolean;
  // A Workspace admin. Central never changes these.
  isAdmin: boolean;
  // True until the person has set their own password.
  changePasswordAtNextLogin: boolean;
  // null when they never signed in.
  lastLoginTime: Date | null;
  // Only on a deleted user: when it was deleted. Google restores it for 20 days after that.
  deletionTime?: Date | null;
};

export type CreateDirectoryUser = {
  primaryEmail: string;
  givenName: string;
  familyName: string;
  // Nobody knows it: the person sets their own through recovery, or an admin resets it.
  password: string;
  recoveryEmail?: string;
  orgUnitPath?: string;
};

export type UpdateDirectoryUser = {
  primaryEmail?: string;
  givenName?: string;
  familyName?: string;
};

export type DirectoryErrorCode = "EXISTS" | "NOT_FOUND" | "DENIED" | "FAILED";

export class DirectoryError extends Error {
  constructor(
    readonly code: DirectoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DirectoryError";
  }
}

export interface DirectoryClient {
  readonly mode: "google" | "simulated";
  // null when Google has no such user.
  findUser(userKey: string): Promise<DirectoryUser | null>;
  // A user deleted in Google, still inside the restore window (about 20 days), matched by Google id or by email. Its
  // address is still reserved. null only when there is none: a Google that cannot answer throws.
  findDeletedUser(email: string, userId?: string | null): Promise<DirectoryUser | null>;
  // Every user of the Workspace, or every deleted one that can still be restored. For checking many people in one go.
  listUsers(options: { deleted: boolean }): Promise<DirectoryUser[]>;
  createUser(input: CreateDirectoryUser): Promise<DirectoryUser>;
  updateUser(userKey: string, patch: UpdateDirectoryUser): Promise<DirectoryUser>;
  // Brings a deleted user back (inside the 20 days), into the given org unit.
  restoreUser(userId: string, orgUnitPath: string): Promise<DirectoryUser>;
  // A suspended user cannot sign in, and nothing of theirs is lost.
  setSuspended(userKey: string, suspended: boolean): Promise<DirectoryUser>;
  // Always asks for a new password at the next login.
  resetPassword(userKey: string, password: string): Promise<void>;
  setPhoto(userKey: string, photo: Buffer, mimeType: string): Promise<void>;
}
