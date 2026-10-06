// Select options for the roles of one application, highest first.
export function roleOptions(roles) {
  return roles.map((role) => ({
    value: role.key,
    label: role.key,
    description: `${role.label}, ${role.permissions.length} permission${role.permissions.length === 1 ? "" : "s"}`,
  }));
}
