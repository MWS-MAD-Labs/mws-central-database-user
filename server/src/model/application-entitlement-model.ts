import type { ApplicationEntitlement, ApplicationRole } from "../generated/prisma/client";

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
