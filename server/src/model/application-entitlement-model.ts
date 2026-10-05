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
  organization_id: string;
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
  organization_id: string;
  role: string;
};

export type SetApplicationAccessRuleRequest = {
  application_id: string;
  audience: ApplicationAudience;
  unit_ids?: string[];
  default_role_key: string;
  organization_id: string;
  is_active?: boolean;
};

export type ApplicationAccessRuleResponse = {
  id: string;
  application_id: string;
  audience: ApplicationAudience;
  unit_ids: string[];
  default_role_key: string;
  organization_id: string;
  is_active: boolean;
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
    default_role_key: rule.default_role_key,
    organization_id: rule.organization_id,
    is_active: rule.is_active,
    updated_at: rule.updated_at.toISOString(),
  };
}

export type ApplicationEntitlementListItem = ApplicationEntitlementResponse & {
  person: { full_name: string; email: string; unit: string | null };
};

export type ApplicationRoleResponse = {
  id: string;
  application_id: string;
  key: string;
  label: string;
  permissions: string[];
  is_active: boolean;
  active_entitlement_count: number;
  created_at: string;
  updated_at: string;
};

export type CreateApplicationRoleRequest = {
  application_id: string;
  key: string;
  label: string;
  permissions: string[];
};

export type UpdateApplicationRoleRequest = {
  id: string;
  label?: string;
  permissions?: string[];
  is_active?: boolean;
};

export type ListApplicationRolesRequest = {
  application_id?: string;
  is_active?: boolean;
};

export function toApplicationRoleResponse(
  role: ApplicationRole,
  activeEntitlementCount: number,
): ApplicationRoleResponse {
  return {
    id: role.id,
    application_id: role.application_id,
    key: role.key,
    label: role.label,
    permissions: role.permissions,
    is_active: role.is_active,
    active_entitlement_count: activeEntitlementCount,
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
