import type { ApplicationEntitlement } from "../generated/prisma/client";

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
  permissions: string[];
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
  is_active?: boolean;
};

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
