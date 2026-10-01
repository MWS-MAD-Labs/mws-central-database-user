import type {
  AcademicYear,
  Class,
  EnrollmentStatus,
  Person,
  Student,
  StudentClassEnrollment,
  StudentStatus,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";
import type { BulkActionResponse } from "./bulk-action-model";
import type { StudentResponse } from "./student-model";

// name/nis sort by the student, grade by the enrollment's grade level.
export const ENROLLMENT_SORT_FIELDS = [
  "created_at",
  "start_date",
  "name",
  "nis",
  "grade",
] as const;

export type EnrollmentSortField = (typeof ENROLLMENT_SORT_FIELDS)[number];

export type CreateEnrollmentRequest = {
  student_id: string;
  class_id: string;
  academic_year_id?: string;
  start_date?: string;
  // Historical backfill requires the next missing grade and academic year.
  is_legacy?: boolean;
};

export type BulkCreateEnrollmentRequest = Omit<
  CreateEnrollmentRequest,
  "student_id"
> & {
  student_ids: string[];
};

export type BulkCreateEnrollmentResponse =
  BulkActionResponse<EnrollmentResponse>;

// Previews placeholder enrollments created by PSB first-enrollment backfill.
export type PreviewBackfillRequest = {
  student_ids: string[];
  class_id: string;
  academic_year_id?: string;
};

export type PreviewBackfillStep = {
  grade_id: string;
  grade_name: string;
  academic_year_id: string;
  academic_year_name: string;
  // Null until the placeholder class exists.
  placeholder_class_id: string | null;
};

// Includes only students eligible for automatic backfill.
export type PreviewBackfillEntry = {
  student_id: string;
  full_name: string;
  steps: PreviewBackfillStep[];
};

export type PromoteEnrollmentRequest = {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  grade_id: string;
  effective_date?: string;
  is_retention?: boolean;
  retention_reason?: string;
  // Required when advancing more than one grade level.
  confirm_grade_skip?: boolean;
};

export type BulkPromoteEnrollmentRequest = Omit<
  PromoteEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type BulkPromoteEnrollmentResponse =
  BulkActionResponse<EnrollmentResponse>;

export type TransferEnrollmentRequest = {
  id: string;
  student_id: string;
  class_id: string;
  effective_date?: string;
};

export type BulkTransferEnrollmentRequest = Omit<
  TransferEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type BulkTransferEnrollmentResponse =
  BulkActionResponse<EnrollmentResponse>;

// Placeholder correction changes one enrollment in place without chain effects.
export type FixEnrollmentClassRequest = {
  id: string;
  student_id: string;
  class_id: string;
};

export type CloseEnrollmentRequest = {
  id: string;
  student_id: string;
  status: "COMPLETED" | "TRANSFERRED" | "WITHDRAWN";
  end_date?: string;
  // Graduation grade is stored on the student when closing as completed.
  graduation_grade?: string;
  leave_year?: string;
};

export type BulkCloseEnrollmentRequest = Omit<
  CloseEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type UpdateEnrollmentStartDateRequest = {
  id: string;
  student_id: string;
  start_date: string;
};

export type BulkUpdateEnrollmentStartDateRequest = {
  enrollment_ids: string[];
  start_date: string;
};

export type BulkCloseEnrollmentResponse = BulkActionResponse<EnrollmentResponse>;

// Removing a promoted enrollment reactivates its predecessor atomically.
export type RemoveEnrollmentRequest = {
  id: string;
  student_id: string;
};

export type BulkRemoveEnrollmentRequest = Omit<
  RemoveEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type BulkRemoveEnrollmentResponse = BulkActionResponse<boolean>;

// Reopening updates the existing enrollment to preserve its unique slot.
export type ReactivateEnrollmentRequest = {
  id: string;
  student_id: string;
};

export type BulkReactivateEnrollmentRequest = Omit<
  ReactivateEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type BulkReactivateEnrollmentResponse =
  BulkActionResponse<EnrollmentResponse>;

export type RestoreEnrollmentRequest = {
  id: string;
  student_id: string;
};

export type GetEnrollmentHistoryRequest = {
  student_id: string;
  is_deleted?: boolean;
};

export type SearchEnrollmentRequest = {
  page: number;
  size: number;
  student_id?: string;
  class_id?: string;
  // Filters a mixed-age roster by the enrollment grade.
  grade_id?: string;
  academic_year_id?: string;
  status?: EnrollmentStatus;
  is_deleted?: boolean;
  sort_by?: EnrollmentSortField;
  sort_order?: "asc" | "desc";
};

export type SearchEnrollmentCandidatesRequest = {
  class_id: string;
  page: number;
  size: number;
  search?: string;
  grade_id?: string;
  is_legacy?: boolean;
};

export type EnrollmentCandidatesResponse = {
  data: StudentResponse[];
  paging: {
    size: number;
    current_page: number;
    total_page: number;
    total_item: number;
  };
  meta: {
    capacity: number | null;
    active_enrollment_count: number;
    available_seats: number | null;
  };
};

export type EnrollmentWithRelations = StudentClassEnrollment & {
  class: Class;
  academic_year: AcademicYear;
  student: Student & { person: Person };
};

export type EnrollmentResponse = {
  id: string;
  student: {
    id: string;
    nis: string | null;
    full_name: string;
    // Student status may be inactive while the enrollment remains active.
    status: StudentStatus;
    // Search flags any unresolved placeholder class in the student's history.
    has_unresolved_placeholder_class: boolean;
  };
  class: {
    id: string;
    name: string;
  };
  academic_year: {
    id: string;
    name: string;
    status: AcademicYear["status"];
  };
  grade_level: string;
  class_name_snapshot: string;
  enrollment_status: EnrollmentStatus;
  start_date: string | null;
  end_date: string | null;
  is_retention: boolean;
  retention_reason: string | null;
  // Identifies whether removal should roll back a promotion or drop the first enrollment.
  promoted_from_enrollment_id: string | null;
  created_at: string;
  updated_at: string;
};

export function toEnrollmentResponse(
  enrollment: EnrollmentWithRelations,
  // Only search computes the placeholder-history flag.
  hasUnresolvedPlaceholderClass: boolean = false,
): EnrollmentResponse {
  return {
    id: enrollment.id,
    student: {
      id: enrollment.student.id,
      nis: enrollment.student.nis,
      full_name: enrollment.student.person.full_name,
      status: enrollment.student.status,
      has_unresolved_placeholder_class: hasUnresolvedPlaceholderClass,
    },
    class: {
      id: enrollment.class.id,
      name: enrollment.class.name,
    },
    academic_year: {
      id: enrollment.academic_year.id,
      name: enrollment.academic_year.name,
      status: enrollment.academic_year.status,
    },
    grade_level: enrollment.grade_level,
    class_name_snapshot: enrollment.class_name_snapshot,
    enrollment_status: enrollment.enrollment_status,
    start_date: enrollment.start_date
      ? enrollment.start_date.toISOString()
      : null,
    end_date: enrollment.end_date ? enrollment.end_date.toISOString() : null,
    is_retention: enrollment.is_retention,
    retention_reason: enrollment.retention_reason,
    promoted_from_enrollment_id: enrollment.promoted_from_enrollment_id,
    created_at: enrollment.created_at.toISOString(),
    updated_at: enrollment.updated_at.toISOString(),
  };
}

// Flat roster export row using enrollment snapshots.
export type ClassRosterExportRow = {
  nis: string;
  full_name: string;
  grade_level: string;
  enrollment_status: EnrollmentStatus;
  start_date: string | null;
  end_date: string | null;
};

export function toClassRosterExportRow(
  enrollment: Pick<
    StudentClassEnrollment,
    "grade_level" | "enrollment_status" | "start_date" | "end_date"
  >,
  student: { nis: string | null; full_name: string },
): ClassRosterExportRow {
  return {
    nis: student.nis ?? "",
    full_name: student.full_name,
    grade_level: enrollment.grade_level,
    enrollment_status: enrollment.enrollment_status,
    start_date: enrollment.start_date
      ? enrollment.start_date.toISOString()
      : null,
    end_date: enrollment.end_date ? enrollment.end_date.toISOString() : null,
  };
}

export function toEnrollmentAuditSnapshot(
  enrollment: StudentClassEnrollment,
  studentFullName?: string,
): AuditValue {
  return {
    student_id: enrollment.student_id,
    // Audit labels resolve from full_name.
    full_name: studentFullName ?? null,
    academic_year_id: enrollment.academic_year_id,
    class_id: enrollment.class_id,
    grade_id: enrollment.grade_id,
    grade_level: enrollment.grade_level,
    class_name_snapshot: enrollment.class_name_snapshot,
    enrollment_status: enrollment.enrollment_status,
    start_date: enrollment.start_date
      ? enrollment.start_date.toISOString()
      : null,
    end_date: enrollment.end_date ? enrollment.end_date.toISOString() : null,
    is_retention: enrollment.is_retention,
    retention_reason: enrollment.retention_reason,
    deleted_at: enrollment.deleted_at
      ? enrollment.deleted_at.toISOString()
      : null,
  };
}
