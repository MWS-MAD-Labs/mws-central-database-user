import type { BulkActionResponse } from "./bulk-action-model";

export type UploadStudentPhotoRequest = {
  student_id: string;
};

export type DeleteStudentPhotoRequest = {
  student_id: string;
};

// Matching is by filename only (no file content needed yet) - lets the
// frontend show a review step before actually uploading anything.
export type BulkPreviewStudentPhotoRequest = {
  file_names: string[];
};

export type StudentPhotoMatchCandidate = {
  id: string;
  full_name: string;
  nis: string | null;
  current_grade: string;
};

export type StudentPhotoPreviewItem = {
  file_name: string;
  candidates: StudentPhotoMatchCandidate[];
};

export type BulkPreviewStudentPhotoResponse = StudentPhotoPreviewItem[];

export type BulkCommitStudentPhotoMapping = {
  file_name: string;
  student_id: string;
};

export type BulkCommitStudentPhotoRequest = {
  mappings: BulkCommitStudentPhotoMapping[];
};

export type BulkCommitStudentPhotoResponse = BulkActionResponse<boolean>;
