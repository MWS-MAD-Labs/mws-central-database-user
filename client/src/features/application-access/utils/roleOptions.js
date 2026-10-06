// Select options for the roles of one application, highest first. The first
// one is tagged so nobody has to guess which role is the strongest.
export function roleOptions(roles) {
  return roles.map((role, index) => ({
    value: role.key,
    label: role.key,
    description: `${role.label}, ${role.permissions.length} permission${role.permissions.length === 1 ? "" : "s"}`,
    badge: index === 0 && roles.length > 1 ? "Highest" : undefined,
  }));
}
