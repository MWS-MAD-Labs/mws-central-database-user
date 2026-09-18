import type { BulkActionResponse } from "./bulk-action-model";

export type UploadStudentPhotoRequest = {
  student_id: string;
};

export type DeleteStudentPhotoRequest = {
  student_id: string;
};

// Match filenames before uploading file contents.
export type BulkPreviewStudentPhotoRequest = {
  file_names: string[];
};

export type StudentPhotoMatchCandidate = {
  id: string;
  full_name: string;
  nis: string | null;
  current_grade: string;
  // Existing photos are skipped by default during bulk upload.
  has_photo: boolean;
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
