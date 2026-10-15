// Only a protected Super Admin manages applications, a regular Super Admin does not.
export function canManageApplications(user) {
  return user?.role === "SUPER_ADMIN" && user?.is_protected === true;
}
