export type ApplicationLogoResponse = {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  version: number;
  used_by: { application_id: string; name: string }[];
  created_at: string;
};
