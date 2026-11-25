export type OrganizationUnitApiResponse = {
  id: string;
  name: string;
  parent_unit_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationUnitDirectoryVersion = {
  key: string;
  total: number;
};
