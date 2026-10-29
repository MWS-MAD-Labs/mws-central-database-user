// Keys are exact: capital letters, digits and underscores.
export function normalizeRoleKey(value) {
  return value
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}
