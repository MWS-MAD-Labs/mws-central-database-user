// The format every permission key follows (Access Standard AS-3): lowercase words joined by dots, two or three levels.
// The first word starts with a letter, the others with a letter or digit, and all may contain "-". "domain.action" or "domain.sub.action", at most 64 characters.
export const STANDARD_PERMISSION_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,2}$/;
export const MAX_STANDARD_KEY_LENGTH = 64;

export function isStandardPermissionKey(key: string): boolean {
  return key.length <= MAX_STANDARD_KEY_LENGTH && STANDARD_PERMISSION_KEY.test(key);
}

// Keys an application already registered stay as they are until it renames them; only new ones have to follow the format.
export function nonStandardKeys(keys: string[]): string[] {
  return keys.filter((key) => !isStandardPermissionKey(key));
}

export function standardKeyMessage(keys: string[]): string {
  return `New permission ${keys.map((key) => `"${key}"`).join(", ")} must be lowercase words joined by dots, like "work-order.create" or "scope.grade" (domain.action, up to 3 levels, 64 characters, "-" inside a word, no ":" or "_"). See docs/access-standard.md AS-3.`;
}

// "warn" (default) accepts keys that are not in the standard format and flags them; "enforce" rejects new ones.
export function permissionKeyMode(): "warn" | "enforce" {
  return process.env.PERMISSION_KEY_FORMAT === "enforce" ? "enforce" : "warn";
}
