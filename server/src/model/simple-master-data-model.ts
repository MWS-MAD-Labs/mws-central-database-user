import type { AuditValue } from "./audit-log-model";

export type SimpleMasterDataEntity = {
  id: string;
  name: string;
  parent_id?: string | null;
  // Only lists whose rows are referred to by a fixed key have one.
  key?: string | null;
  created_at: Date;
  updated_at: Date;
};

export const SIMPLE_MASTER_DATA_SORT_FIELDS = ["name", "created_at"] as const;
export type SimpleMasterDataSortField =
  (typeof SIMPLE_MASTER_DATA_SORT_FIELDS)[number];

export type CreateSimpleMasterDataRequest = {
  name: string;
  parent_id?: string | null;
};

export type UpdateSimpleMasterDataRequest = {
  id: string;
  name?: string;
  parent_id?: string | null;
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
  key?: string;
  name: string;
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
};

export function toSimpleMasterDataResponse(
  entity: SimpleMasterDataEntity,
): SimpleMasterDataResponse {
  return {
    id: entity.id,
    ...(entity.key ? { key: entity.key } : {}),
    name: entity.name,
    ...(entity.parent_id !== undefined ? { parent_id: entity.parent_id } : {}),
    created_at: entity.created_at.toISOString(),
    updated_at: entity.updated_at.toISOString(),
  };
}

export function toSimpleMasterDataAuditSnapshot(
  entity: SimpleMasterDataEntity,
): AuditValue {
  return {
    name: entity.name,
    ...(entity.key ? { key: entity.key } : {}),
    ...(entity.parent_id !== undefined ? { parent_id: entity.parent_id } : {}),
  };
}
