import type { BulkActionResponse } from "./bulk-action-model";

export type UploadEmployeePhotoRequest = {
  employee_id: string;
};

export type DeleteEmployeePhotoRequest = {
  employee_id: string;
};

// Matching is by filename only (no file content needed yet) - lets the
// frontend show a review step before actually uploading anything.
export type BulkPreviewEmployeePhotoRequest = {
  file_names: string[];
};

export type EmployeePhotoMatchCandidate = {
  id: string;
  full_name: string;
  employee_id: string;
  unit: string;
  // True if this employee already has a photo on file - lets the frontend
  // default-skip the row so a bulk re-upload doesn't silently overwrite it.
  has_photo: boolean;
};

export type EmployeePhotoPreviewItem = {
  file_name: string;
  candidates: EmployeePhotoMatchCandidate[];
};

export type BulkPreviewEmployeePhotoResponse = EmployeePhotoPreviewItem[];

export type BulkCommitEmployeePhotoMapping = {
  file_name: string;
  employee_id: string;
};

export type BulkCommitEmployeePhotoRequest = {
  mappings: BulkCommitEmployeePhotoMapping[];
};

export type BulkCommitEmployeePhotoResponse = BulkActionResponse<boolean>;
