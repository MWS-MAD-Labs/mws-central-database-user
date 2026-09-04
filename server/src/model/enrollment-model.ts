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

export const ENROLLMENT_SORT_FIELDS = ["created_at", "start_date"] as const;

export type EnrollmentSortField = (typeof ENROLLMENT_SORT_FIELDS)[number];

export type CreateEnrollmentRequest = {
  student_id: string;
  class_id: string;
  academic_year_id?: string;
  start_date?: string;
  // Backfills a historical record - skips the "class must be ACTIVE" and
  // "class's grade must match the student's current grade" checks (both
  // wrong for a class from a past academic year), and instead requires the
  // grade to be the student's exact next unfilled step (see
  // EnrollmentService.assertLegacyGradeMatchesExpectedStep). Always lands
  // ACTIVE - Promote is what carries a student forward from there.
  // academic_year_id is required when this is set (see
  // EnrollmentValidation.CREATE).
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

// Dry-run for create()'s silent auto-backfill (see
// assertPsbFirstEnrollmentMatchesJoinGrade in enrollment-service.ts) - lets
// the frontend warn "this will also backfill N prior year(s) into
// placeholder classes" before committing, instead of the admin only finding
// out after the fact from Class History. Same shape as
// BulkCreateEnrollmentRequest minus start_date/is_legacy - a legacy
// (Historical Data) create never triggers backfill, so there's nothing to
// preview there.
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
  // The placeholder class this step will land in, if it already exists (an
  // earlier student backfilled into the same grade/year already created
  // it). Null when it doesn't exist yet - create() makes it fresh at commit
  // time, so there's nothing to link to until then.
  placeholder_class_id: string | null;
};

// Only students who will actually get backfilled - one who's not
// REGISTERED+PSB, whose grade doesn't match this class, or who'd hit a
// blocked (too-far-ahead/ambiguous) case are simply absent here. The real
// create() call still reports those per-student, same as today.
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
  // Required when grade_id is more than one level above the student's
  // current grade - see assertValidGradeProgression in enrollment-service.ts.
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
};

export type BulkTransferEnrollmentRequest = Omit<
  TransferEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type BulkTransferEnrollmentResponse =
  BulkActionResponse<EnrollmentResponse>;

// Same shape as TransferEnrollmentRequest, deliberately a separate type -
// fixPlaceholderClass() only ever touches a single placeholder record's
// class_id in place (any status, no chain effects), unlike transfer()
// which requires an ACTIVE source and moves the student's live enrollment.
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
  // Only meaningful when status is COMPLETED (graduated) - see
  // EnrollmentService.close(). Written onto the student record, not the
  // enrollment itself.
  graduation_grade?: string;
  leave_year?: string;
};

export type BulkCloseEnrollmentRequest = Omit<
  CloseEnrollmentRequest,
  "id" | "student_id"
> & {
  enrollment_ids: string[];
};

export type BulkCloseEnrollmentResponse = BulkActionResponse<EnrollmentResponse>;

// Soft-deletes an enrollment. When it has a promoted_from_enrollment_id
// (i.e. it's the result of a promote), also reactivates the enrollment it
// was promoted from in the same transaction - one action ("undo how this
// student got here") rather than two that only differed by that one
// condition.
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

// Undoes a mistaken close (e.g. graduated by accident) - flips a non-ACTIVE,
// non-deleted enrollment back to ACTIVE in place, so it never touches the
// (student_id, academic_year_id) unique index the way a fresh create() would.
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
  // The grade a specific enrollment is recorded at (StudentClassEnrollment.grade_id)
  // - narrows a mixed-age class's roster (see ClassAdditionalGrade) down to
  // one grade at a time, e.g. to bulk-select only the K1 half for promotion.
  grade_id?: string;
  academic_year_id?: string;
  status?: EnrollmentStatus;
  is_deleted?: boolean;
  sort_by?: EnrollmentSortField;
  sort_order?: "asc" | "desc";
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
    // Separate from enrollment_status below - Inactive (a pause layered on
    // top of an otherwise-still-active enrollment, see
    // StudentService.deactivate()) is the one case where these two
    // genuinely diverge: enrollment_status stays ACTIVE, but the student
    // themselves is Inactive. Exposed so the frontend can flag that
    // ambiguity instead of just showing "Active" and implying otherwise.
    status: StudentStatus;
    // True when this student has any non-deleted enrollment (not
    // necessarily this one) sitting in a placeholder "Unknown (Legacy
    // Import)" class - lets a real class's own roster flag "this student
    // still needs Fix Class somewhere in their history" without opening
    // Class History. Only search() actually computes this (see
    // findStudentIdsWithPlaceholderClass) - every other caller of
    // toEnrollmentResponse() gets the default false.
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
  // Points at the enrollment this was promoted from, when it was - lets the
  // frontend decide whether to offer Rollback (was promoted) or Drop (first
  // enrollment, nothing to roll back to) without a separate lookup.
  promoted_from_enrollment_id: string | null;
  created_at: string;
  updated_at: string;
};

export function toEnrollmentResponse(
  enrollment: EnrollmentWithRelations,
  // Not needed by every caller - defaults to false rather than forcing an
  // extra query everywhere toEnrollmentResponse() is called (create/
  // transfer/promote/close/... don't need it). Only search() computes and
  // passes this in today.
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

// Flat row for a per-class roster sheet (export-service). grade_level and
// class_name_snapshot already live on the enrollment row itself, so no
// class/academic_year relation needs joining in for this.
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
): AuditValue {
  return {
    student_id: enrollment.student_id,
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
