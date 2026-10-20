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
  changePasswordAtNextLogin: boolean;
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
  createUser(input: CreateDirectoryUser): Promise<DirectoryUser>;
  updateUser(userKey: string, patch: UpdateDirectoryUser): Promise<DirectoryUser>;
  // Always asks for a new password at the next login.
  resetPassword(userKey: string, password: string): Promise<void>;
  setPhoto(userKey: string, photo: Buffer, mimeType: string): Promise<void>;
}
