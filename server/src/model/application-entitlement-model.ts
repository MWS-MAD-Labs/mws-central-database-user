import type {
  ApplicationAccessRule,
  ApplicationAudience,
  ApplicationEntitlement,
  ApplicationRole,
} from "../generated/prisma/client";

export type ApplicationEntitlementResponse = {
  id: string;
  person_id: string;
  application_id: string;
  organization_id: string;
  role: string;
  permissions: string[];
  version: number;
  is_active: boolean;
  granted_at: string;
  updated_at: string;
  // True when the access comes from the application's baseline rule.
  is_default?: boolean;
};

export type ApplicationEntitlementLookupRequest = {
  person_id?: string;
  application_id?: string;
};

export type GrantApplicationEntitlementRequest = {
  person_id: string;
  application_id: string;
  role: string;
  // Optional: the registry role decides them. When sent they must match.
  permissions?: string[];
};

export type UpdateApplicationEntitlementRequest = {
  id: string;
  role?: string;
  permissions?: string[];
};

export type RevokeApplicationEntitlementRequest = { id: string };

export type ListApplicationEntitlementsRequest = {
  person_id?: string;
  application_id?: string;
  organization_id?: string;
  role?: string;
  is_active?: boolean;
  search?: string;
  page?: number;
  size?: number;
};

export type BulkGrantApplicationEntitlementRequest = {
  person_ids: string[];
  application_id: string;
  role?: string;
  // Block the people instead of giving them a role.
  blocked?: boolean;
};

export type CreateApplicationAccessRuleRequest = {
  application_id: string;
  audience: ApplicationAudience;
  unit_ids?: string[];
  job_position_ids?: string[];
  job_level_ids?: string[];
  default_role_key: string;
  is_active?: boolean;
  allows_exceptions?: boolean;
};

export type UpdateApplicationAccessRuleRequest = {
  id: string;
  unit_ids?: string[];
  job_position_ids?: string[];
  job_level_ids?: string[];
  default_role_key?: string;
  is_active?: boolean;
  allows_exceptions?: boolean;
};

export type DeleteApplicationAccessRuleRequest = { id: string };

export type ListApplicationAccessRequest = {
  kind?: "GROUP" | "PERSON";
  application_id?: string;
  role?: string;
  is_active?: boolean;
  search?: string;
  page?: number;
  size?: number;
};

export type ListApplicationCandidatesRequest = {
  application_id: string;
  coverage?: "ANY" | "COVERED" | "UNCOVERED" | "GROUP";
  group_id?: string;
  exclude_own_access?: boolean;
  unit_id?: string;
  job_position_id?: string;
  job_level_id?: string;
  grade_id?: string;
  class_id?: string;
  unit_ids?: string[];
  job_position_ids?: string[];
  job_level_ids?: string[];
  employment_type?: string;
  search?: string;
  page?: number;
  size?: number;
};

// An active employee with what the application's groups already give them.
export type ApplicationCandidate = {
  person_id: string;
  // Set for students, who have no employee id, job position or level.
  kind?: "EMPLOYEE" | "STUDENT";
  nis?: string | null;
  grade?: string | null;
  class_name?: string | null;
  employee_id: string;
  full_name: string;
  email: string;
  unit: string;
  job_position: string;
  job_level: string;
  employment_type: string;
  inherited_role: string | null;
  inherited_group_id: string | null;
  own_access: { role: string; is_active: boolean } | null;
};

export type ApplicationAccessRuleResponse = {
  id: string;
  application_id: string;
  audience: ApplicationAudience;
  unit_ids: string[];
  job_position_ids: string[];
  job_level_ids: string[];
  default_role_key: string;
  organization_id: string;
  is_active: boolean;
  // Whether exceptions can be made inside the group. Always true for employees.
  allows_exceptions: boolean;
  created_at: string;
  updated_at: string;
};

export function toApplicationAccessRuleResponse(
  rule: ApplicationAccessRule,
): ApplicationAccessRuleResponse {
  return {
    id: rule.id,
    application_id: rule.application_id,
    audience: rule.audience,
    unit_ids: rule.unit_ids,
    job_position_ids: rule.job_position_ids,
    job_level_ids: rule.job_level_ids,
    default_role_key: rule.default_role_key,
    organization_id: rule.organization_id,
    is_active: rule.is_active,
    allows_exceptions: rule.audience === "STUDENTS" ? rule.allows_exceptions : true,
    created_at: rule.created_at.toISOString(),
    updated_at: rule.updated_at.toISOString(),
  };
}

export type ApplicationDetails = {
  name?: string;
  description?: string | null;
  icon?: string | null;
  category?: string | null;
  launch_url?: string | null;
  logout_url?: string | null;
};

export type ApplicationSummary = {
  application_id: string;
  name: string;
  published: boolean;
  organization_id: string | null;
  role_count: number;
  active_group_count: number;
  exception_count: number;
  blocked_count: number;
  updated_at: string | null;
};

export type ListApplicationsRequest = { search?: string; page?: number; size?: number };

export type CreateApplicationRequest = { application_id: string } & ApplicationDetails;
export type UpdateApplicationRequest = { application_id: string } & ApplicationDetails;

export type ApplicationExceptionRow = {
  id: string;
  person_id: string;
  kind: "EMPLOYEE" | "STUDENT";
  nis: string | null;
  grade: string | null;
  class_name: string | null;
  full_name: string;
  email: string;
  unit: string | null;
  job_position: string | null;
  job_level: string | null;
  employment_type: string | null;
  role: string;
  permissions: string[];
  is_active: boolean;
  granted_at: string;
};

// Values of one dimension a group still holds, and the ones narrower groups took.
export type ScopeLeft = {
  kept: { id: string; name: string }[];
  dropped: { id: string; name: string }[];
};

export type ApplicationGroupCard = ApplicationAccessRuleResponse & {
  parent_group_id: string | null;
  units: { id: string; name: string }[];
  job_positions: { id: string; name: string }[];
  job_levels: { id: string; name: string }[];
  permissions: string[];
  exception_count: number;
  blocked_count: number;
  // Active people the scope reaches, before exceptions and narrower groups.
  covered_count: number;
  // Active people this group is the nearest group of (covered, minus narrower groups).
  own_count: number;
  // What is left of each dimension after narrower groups take theirs. null: nothing dropped.
  remaining: {
    units: ScopeLeft | null;
    job_positions: ScopeLeft | null;
    job_levels: ScopeLeft | null;
  };
};

export type ApplicationDetail = {
  application_id: string;
  organization_id: string | null;
  groups: ApplicationGroupCard[];
  // Older access of people no group covers.
  other_count: number;
};

export type ApplicationScopeCatalog = {
  units: { id: string; name: string }[];
  job_positions: { id: string; name: string; unit_ids: string[] }[];
  job_levels: { id: string; name: string; unit_ids: string[] }[];
  // Per position, the levels it can be paired with.
  pairs: Record<string, string[]>;
  // Units that have grades, so the only ones students can be in.
  student_unit_ids: string[];
};

export type ListRoleOptionsRequest = {
  audience: ApplicationAudience;
  unit_ids?: string[];
  job_position_ids?: string[];
  job_level_ids?: string[];
  group_id?: string;
};

export type ApplicationRoleOptions = {
  // Roles a group with this scope cannot take, with the reason.
  unavailable: { role: string; reason: string }[];
};

export type ListApplicationExceptionsRequest = {
  group_id: string;
  search?: string;
  page?: number;
  size?: number;
};

// One row of the combined Access list: a group rule or a person's entitlement.
export type ApplicationAccessRow = {
  kind: "GROUP" | "PERSON";
  id: string;
  application_id: string;
  role: string;
  permissions: string[];
  organization_id: string;
  is_active: boolean;
  granted_at: string;
  updated_at: string;
  group: {
    audience: ApplicationAudience;
    units: { id: string; name: string }[];
    job_positions: { id: string; name: string }[];
    job_levels: { id: string; name: string }[];
  } | null;
  person: { person_id: string; full_name: string; email: string; unit: string | null } | null;
};

export type ApplicationEntitlementListItem = ApplicationEntitlementResponse & {
  person: { full_name: string; email: string; unit: string | null };
};

export type ApplicationRoleResponse = {
  id: string;
  application_id: string;
  key: string;
  label: string;
  permissions: string[];
  rank: number;
  is_active: boolean;
  allows_employees: boolean;
  allows_students: boolean;
  active_entitlement_count: number;
  // Active groups that hand this role out.
  active_group_count: number;
  // Permissions its permissions need that it does not carry. Empty when the role is complete.
  missing_permissions: string[];
  created_at: string;
  updated_at: string;
};

export type CreateApplicationRoleRequest = {
  application_id: string;
  key: string;
  label: string;
  permissions: string[];
  allows_employees?: boolean;
  allows_students?: boolean;
};

export type UpdateApplicationRoleRequest = {
  id: string;
  label?: string;
  permissions?: string[];
  allows_employees?: boolean;
  allows_students?: boolean;
  is_active?: boolean;
};

export type ReorderApplicationRolesRequest = {
  application_id: string;
  role_ids: string[];
};

export type ListApplicationRolesRequest = {
  application_id?: string;
  is_active?: boolean;
};

export function toApplicationRoleResponse(
  role: ApplicationRole,
  activeEntitlementCount: number,
  activeGroupCount = 0,
  missingPermissions: string[] = [],
): ApplicationRoleResponse {
  return {
    id: role.id,
    application_id: role.application_id,
    key: role.key,
    label: role.label,
    permissions: role.permissions,
    rank: role.rank,
    allows_employees: role.allows_employees,
    allows_students: role.allows_students,
    is_active: role.is_active,
    active_entitlement_count: activeEntitlementCount,
    active_group_count: activeGroupCount,
    missing_permissions: missingPermissions,
    created_at: role.created_at.toISOString(),
    updated_at: role.updated_at.toISOString(),
  };
}

export function toApplicationEntitlementResponse(
  entitlement: ApplicationEntitlement,
): ApplicationEntitlementResponse {
  return {
    id: entitlement.id,
    person_id: entitlement.person_id,
    application_id: entitlement.application_id,
    organization_id: entitlement.organization_id,
    role: entitlement.role,
    permissions: entitlement.permissions,
    version: entitlement.version,
    is_active: entitlement.is_active,
    granted_at: entitlement.granted_at.toISOString(),
    updated_at: entitlement.updated_at.toISOString(),
  };
}
