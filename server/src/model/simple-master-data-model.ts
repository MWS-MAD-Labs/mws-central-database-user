import type { AuditValue } from "./audit-log-model";

export type SimpleMasterDataEntity = {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
};

export const SIMPLE_MASTER_DATA_SORT_FIELDS = ["name", "created_at"] as const;
export type SimpleMasterDataSortField =
  (typeof SIMPLE_MASTER_DATA_SORT_FIELDS)[number];

export type CreateSimpleMasterDataRequest = {
  name: string;
};

export type UpdateSimpleMasterDataRequest = {
  id: string;
  name?: string;
};

export type GetSimpleMasterDataRequest = {
  id: string;
};

export type DeleteSimpleMasterDataRequest = {
  id: string;
};

export type SearchSimpleMasterDataRequest = {
  page: number;
  size: number;
  search?: string;
  sort_by?: SimpleMasterDataSortField;
  sort_order?: "asc" | "desc";
};

export type SimpleMasterDataResponse = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export function toSimpleMasterDataResponse(
  entity: SimpleMasterDataEntity,
): SimpleMasterDataResponse {
  return {
    id: entity.id,
    name: entity.name,
    created_at: entity.created_at.toISOString(),
    updated_at: entity.updated_at.toISOString(),
  };
}

export function toSimpleMasterDataAuditSnapshot(
  entity: SimpleMasterDataEntity,
): AuditValue {
  return { name: entity.name };
}
