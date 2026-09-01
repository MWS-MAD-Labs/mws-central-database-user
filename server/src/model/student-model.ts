import type {
  Class,
  ConsentStatus,
  Gender,
  Grade,
  HealthRecord,
  PCDay,
  Person,
  Prisma,
  Religion,
  Student,
  StudentEntryType,
  StudentStatus,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";
import type { BulkActionResponse, BulkIdsRequest } from "./bulk-action-model";

export const STUDENT_SORT_FIELDS = [
  "created_at",
  "full_name",
  "nick_name",
  "email",
  "gender",
  "nis",
  "nisn",
  "status",
  "class",
  "grade",
  "join_year",
] as const;

export type StudentSortField = (typeof STUDENT_SORT_FIELDS)[number];

export interface StudentCreateOptions {
  disableAutoGenerateNis?: boolean;
}
export function buildStudentOrderBy(
  sortBy: StudentSortField,
  sortOrder: "asc" | "desc",
): Prisma.PersonOrderByWithRelationInput {
  const sortMap: Record<
    StudentSortField,
    Prisma.PersonOrderByWithRelationInput
  > = {
    created_at: { created_at: sortOrder },
    full_name: { full_name: sortOrder },
    nick_name: { nick_name: sortOrder },
    email: { email: sortOrder },
    gender: { gender: sortOrder },

    // Relation 1
    nis: { student: { nis: sortOrder } },
    nisn: { student: { nisn: sortOrder } },
    status: { student: { status: sortOrder } },

    // Relation 2
    class: { student: { current_class: { name: sortOrder } } },
    grade: { student: { current_grade: { name: sortOrder } } },
    join_year: { student: { join_academic_year: { name: sortOrder } } },
  };

  return sortMap[sortBy] || { created_at: sortOrder };
}

export type CreateStudentRequest = {
  full_name: string;
  nick_name: string;
  email: string;
  gender: Gender;
  religion: Religion;
  // Only meaningful when religion is OTHER.
  religion_other?: string | null;
  birth_place: string;
  birth_date: string;
  photo_url?: string;

  // Auto-generated server-side when omitted - only import supplies it
  // directly, already pattern-validated.
  nis?: string;
  // Raw historical NIS value from a legacy import, preserved even after
  // nis is backfilled via StudentService.reissueNis().
  legacy_nis?: string;
  nisn?: string;
  // Mirrors legacy_nis - raw historical NISN value from a legacy import,
  // preserved when the sheet's NISN doesn't fit NISN_REGEX.
  legacy_nisn?: string;
  status?: StudentStatus;
  current_grade_id: string;
  join_academic_year_id: string;
  join_grade_id: string;
  previous_school?: string;
  pickup_drop_service?: boolean;
  catering_service?: boolean;
  psb_guide?: boolean;
  entry_type: StudentEntryType;

  // Legacy-import-only: a student can be created directly with a terminal
  // status (e.g. a historical graduate migrated from the old sheet, who
  // has no enrollment history in central to derive these from). Required
  // together when status is GRADUATED - see StudentValidation.CREATE.
  graduation_grade?: string;
  leave_year?: string;
  sn?: boolean;

  // Super-Admin-only escape hatch for a current grade that's genuinely
  // ahead of what the join grade/year can account for (a real grade skip,
  // not a data entry mismatch) - see tooFarAheadMessage() in
  // student-service.ts. Required together with a non-empty reason to
  // actually bypass the check; logged to the audit trail either way.
  override_too_far_ahead_reason?: string;

  // Which fields import-service.ts silently filled with a placeholder
  // because the sheet had nothing - "religion" | "birth_place" |
  // "birth_date" | "status". Persisted so it's still visible on the
  // student's detail page after the fact, not just during that import's
  // preview.
  import_defaulted_fields?: string[];
};

export type UpdateStudentRequest = {
  id: string;

  full_name?: string;
  nick_name?: string;
  email?: string;
  gender?: Gender;
  religion?: Religion;
  religion_other?: string | null;
  birth_place?: string;
  birth_date?: string;
  photo_url?: string;

  // nis is intentionally not editable - assigned once at create, never regenerated.
  nisn?: string;
  legacy_nisn?: string;
  status?: StudentStatus;
  current_grade_id?: string;
  join_academic_year_id?: string;
  join_grade_id?: string;
  previous_school?: string;
  graduation_grade?: string;
  leave_year?: string;
  sn?: boolean;
  entry_type?: StudentEntryType;
  pickup_drop_service?: boolean;
  catering_service?: boolean;
  psb_guide?: boolean;
};

export type GetStudentRequest = {
  id: string;
};

export type RemoveStudentRequest = {
  id: string;
};

export type RestoreStudentRequest = {
  id: string;
};

export type ReissueStudentNisRequest = {
  id: string;
  entry_type: StudentEntryType;
  // Optional - corrects Join Grade/Year (often "Unknown (Legacy Import)")
  // in the same step, since the NIS prefix is computed from these two.
  join_grade_id?: string;
  join_academic_year_id?: string;
};

export type DeactivateStudentRequest = {
  id: string;
};

export type ReactivateStudentRequest = {
  id: string;
};

export type BulkStudentRequest = BulkIdsRequest;

export type BulkStudentResponse = BulkActionResponse<StudentResponse | boolean>;

// Historical Data (backfill) enrollment picker - narrows the student list
// to those for whom this specific class (academic year + grade) is
// actually their next unfilled step (see StudentService.
// getBackfillCandidates), instead of every student in the system.
export type GetBackfillCandidatesRequest = {
  academic_year_id: string;
  grade_id: string;
  page: number;
  size: number;
};

export type SearchStudentRequest = {
  page: number;
  size: number;
  search?: string;

  gender?: Gender;
  religion?: Religion;

  status?: StudentStatus;
  current_grade_id?: string;
  current_class_id?: string;
  join_academic_year_id?: string;
  leave_year?: string;

  pickup_drop_service?: boolean;
  catering_service?: boolean;
  psb_guide?: boolean;

  consent_status?: ConsentStatus;
  pc_activity_day?: PCDay;

  is_deleted?: boolean;
  sort_by?: StudentSortField;
  sort_order?: "asc" | "desc";
};
export type StudentResponse = {
  id: string;
  person_id: string;

  identity: {
    full_name: string;
    nick_name: string;
    email: string;
    gender: Gender;
    religion: Religion;
  };

  academic: {
    nis: string | null;
    legacy_nis: string | null;
    nisn: string | null;
    legacy_nisn: string | null;
    import_defaulted_fields: string[];
    grade_consistency_override_reason: string | null;
    current_grade: string;
    // Optional - only populated by callers whose query includes the
    // current_class relation (currently just search()). Other callers
    // (create/update/restore/...) omit it rather than adding the relation
    // everywhere it isn't actually consumed.
    current_class_id?: string | null;
    current_class?: string | null;
    join_academic_year_id: string;
    join_grade_id: string;
    join_grade: string;
    previous_school: string | null;
    has_class_history: boolean;
  };

  status: StudentStatus;
  created_at: string;
};

export type StudentDetailResponse = Omit<
  StudentResponse,
  "identity" | "academic"
> & {
  identity: StudentResponse["identity"] & {
    religion_other: string | null;
    birth_place: string;
    birth_date: string;
    photo_url: string | null;
  };
  academic: StudentResponse["academic"] & {
    current_class_id: string | null;
    current_class: string | null;
    graduation_grade: string | null;
    leave_year: string | null;
    // True once a real completed enrollment exists on file - graduation_grade/
    // leave_year should be treated as locked (read-only) in that case, since
    // the enrollment record is the source of truth (fix mistakes via
    // Reactivate + re-Close, not by editing these directly). Only false for
    // legacy-imported graduates with no enrollment history to derive from.
    has_completed_enrollment: boolean;
    // True once a real, non-rolled-back enrollment exists - current_grade
    // should be treated as locked (read-only) in that case, same reasoning
    // as has_completed_enrollment above. Unlike has_class_history (which
    // counts every enrollment ever created, including soft-deleted/rolled-
    // back ones, for the "No class history" badge's own purposes), this one
    // filters deleted_at: null so an Enroll that was later undone doesn't
    // leave the field stuck locked forever.
    has_active_enrollment_history: boolean;
    // The next academic year (chronologically after their latest enrollment,
    // or their own join year if they have none yet) that's already ACTIVE
    // or COMPLETED but has no enrollment record for this student - null
    // once they're fully caught up, or for a student whose journey is
    // intentionally over (GRADUATED/TRANSFERRED/WITHDRAWN/INACTIVE).
    // expected_grade is the grade a backfill into that year must use (their
    // join grade if they have no enrollment at all, otherwise whatever
    // grade their preceding year's enrollment was in) - null only if that
    // preceding grade can't be resolved.
    next_unenrolled_academic_year: {
      id: string;
      name: string;
      expected_grade: { id: string; name: string } | null;
    } | null;
    // Old sheet's "SN" is a checkbox (TRUE/FALSE), not free text.
    sn: boolean;
    entry_type: StudentEntryType;
    pickup_drop_service: boolean;
    catering_service: boolean;
    psb_guide: boolean;
  };
  health: {
    blood_type: string | null;
    needs_assistance: boolean;
  } | null;
};

export type StudentWithGrades = Student & {
  current_grade: Grade;
  join_grade: Grade;
  current_class?: Class | null;
  health?: HealthRecord | null;
  _count?: { enrollments: number };
};

export type PersonWithStudent = Person & { student: StudentWithGrades | null };

export function toStudentResponse(person: PersonWithStudent): StudentResponse {
  const student = person.student!;

  return {
    id: student.id,
    person_id: person.id,

    identity: {
      full_name: person.full_name,
      nick_name: person.nick_name,
      email: person.email,
      gender: person.gender,
      religion: person.religion,
    },

    academic: {
      nis: student.nis,
      legacy_nis: student.legacy_nis,
      nisn: student.nisn,
      legacy_nisn: student.legacy_nisn,
      import_defaulted_fields: student.import_defaulted_fields,
      grade_consistency_override_reason:
        student.grade_consistency_override_reason,
      current_grade: student.current_grade.name,
      current_class_id: student.current_class_id,
      current_class: student.current_class?.name ?? null,
      join_academic_year_id: student.join_academic_year_id,
      join_grade_id: student.join_grade_id,
      join_grade: student.join_grade.name,
      previous_school: student.previous_school,
      has_class_history: (student._count?.enrollments ?? 0) > 0,
    },

    status: student.status,
    created_at: student.created_at.toISOString(),
  };
}

export function toStudentDetailResponse(
  person: PersonWithStudent,
  // Not needed by every caller (e.g. export-service.ts never reads this
  // field) - defaults to false rather than forcing an extra query everywhere.
  hasCompletedEnrollment: boolean = false,
  hasActiveEnrollmentHistory: boolean = false,
  nextUnenrolledAcademicYear: {
    id: string;
    name: string;
    expected_grade: { id: string; name: string } | null;
  } | null = null,
): StudentDetailResponse {
  const baseResponse = toStudentResponse(person);
  const student = person.student!;

  return {
    ...baseResponse,
    identity: {
      ...baseResponse.identity,
      religion_other: person.religion_other,
      birth_place: person.birth_place,
      birth_date: person.birth_date.toISOString(),
      photo_url: person.photo_url,
    },
    academic: {
      ...baseResponse.academic,
      current_class_id: student.current_class_id,
      current_class: student.current_class?.name ?? null,
      graduation_grade: student.graduation_grade,
      leave_year: student.leave_year,
      has_completed_enrollment: hasCompletedEnrollment,
      has_active_enrollment_history: hasActiveEnrollmentHistory,
      next_unenrolled_academic_year: nextUnenrolledAcademicYear,
      sn: student.sn,
      entry_type: student.entry_type,
      pickup_drop_service: student.pickup_drop_service,
      catering_service: student.catering_service,
      psb_guide: student.psb_guide,
    },
    health: student.health
      ? {
          blood_type: student.health.blood_type,
          needs_assistance: student.health.needs_assistance,
        }
      : null,
  };
}
// Flat row for CSV/Excel export, built from whichever DTO the caller
// resolved - keeps the sensitive-data gate in ExportService, not duplicated here.
export type StudentExportRow = {
  id: string;
  full_name: string;
  nick_name: string;
  email: string;
  gender: Gender;
  religion: Religion;
  religion_other: string | null;
  nis: string | null;
  legacy_nis: string | null;
  nisn: string | null;
  legacy_nisn: string | null;
  current_grade: string;
  join_academic_year: string;
  join_grade: string;
  previous_school: string | null;
  status: StudentStatus;
  created_at: string;
  birth_place: string | null;
  birth_date: string | null;
  photo_url: string | null;
  current_class: string | null;
  current_class_start_date: string | null;
  current_class_end_date: string | null;
  graduation_grade: string | null;
  leave_year: string | null;
  sn: boolean | null;
  pickup_drop_service: boolean | null;
  catering_service: boolean | null;
  psb_guide: boolean | null;
  blood_type: string | null;
};

export function toStudentExportRow(
  response: StudentResponse | StudentDetailResponse,
  // Export needs the readable name, not the FK id - responses stay id-only
  // since edit forms need the id to pre-select the right option.
  names: {
    join_academic_year: string;
    current_class: string | null;
    current_class_start_date: string | null;
    current_class_end_date: string | null;
  },
): StudentExportRow {
  const detailIdentity =
    "birth_date" in response.identity ? response.identity : null;
  // current_class_id/current_class now also appear on the base response
  // (optionally), so they no longer discriminate detail vs. base here -
  // graduation_grade is still detail-only.
  const detailAcademic =
    "graduation_grade" in response.academic ? response.academic : null;
  const detailHealth = "health" in response ? response.health : null;

  return {
    id: response.id,
    full_name: response.identity.full_name,
    nick_name: response.identity.nick_name,
    email: response.identity.email,
    gender: response.identity.gender,
    religion: response.identity.religion,
    religion_other: detailIdentity?.religion_other ?? null,
    nis: response.academic.nis,
    legacy_nis: response.academic.legacy_nis,
    nisn: response.academic.nisn,
    legacy_nisn: response.academic.legacy_nisn,
    current_grade: response.academic.current_grade,
    join_academic_year: names.join_academic_year,
    join_grade: response.academic.join_grade,
    previous_school: response.academic.previous_school,
    status: response.status,
    created_at: response.created_at,
    birth_place: detailIdentity?.birth_place ?? null,
    birth_date: detailIdentity?.birth_date ?? null,
    photo_url: detailIdentity?.photo_url ?? null,
    current_class: names.current_class,
    current_class_start_date: names.current_class_start_date,
    current_class_end_date: names.current_class_end_date,
    graduation_grade: detailAcademic?.graduation_grade ?? null,
    leave_year: detailAcademic?.leave_year ?? null,
    sn: detailAcademic?.sn ?? null,
    pickup_drop_service: detailAcademic?.pickup_drop_service ?? null,
    catering_service: detailAcademic?.catering_service ?? null,
    psb_guide: detailAcademic?.psb_guide ?? null,
    blood_type: detailHealth?.blood_type ?? null,
  };
}

export function toStudentAuditSnapshot(
  person: Person,
  student: Student,
): AuditValue {
  return {
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    gender: person.gender,
    religion: person.religion,
    religion_other: person.religion_other,
    birth_place: person.birth_place,
    birth_date: person.birth_date.toISOString(),
    nis: student.nis,
    legacy_nis: student.legacy_nis,
    nisn: student.nisn,
    legacy_nisn: student.legacy_nisn,
    status: student.status,
    current_grade_id: student.current_grade_id,
    join_academic_year_id: student.join_academic_year_id,
    join_grade_id: student.join_grade_id,
    previous_school: student.previous_school,
    graduation_grade: student.graduation_grade,
    leave_year: student.leave_year,
    sn: student.sn,
    entry_type: student.entry_type,
    pickup_drop_service: student.pickup_drop_service,
    catering_service: student.catering_service,
    psb_guide: student.psb_guide,
  };
}
