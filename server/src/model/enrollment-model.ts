import type {
  AcademicYear,
  Class,
  EnrollmentStatus,
  Person,
  Student,
  StudentClassEnrollment,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const ENROLLMENT_SORT_FIELDS = ["created_at", "start_date"] as const;

export type EnrollmentSortField = (typeof ENROLLMENT_SORT_FIELDS)[number];

export type CreateEnrollmentRequest = {
  student_id: string;
  class_id: string;
  academic_year_id?: string;
  start_date?: string;
};

export type PromoteEnrollmentRequest = {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  grade_id: string;
  effective_date?: string;
};

export type TransferEnrollmentRequest = {
  id: string;
  student_id: string;
  class_id: string;
};

export type CloseEnrollmentRequest = {
  id: string;
  student_id: string;
  status: "TRANSFERRED" | "WITHDRAWN";
  end_date?: string;
};

export type GetEnrollmentHistoryRequest = {
  student_id: string;
};

export type SearchEnrollmentRequest = {
  page: number;
  size: number;
  student_id?: string;
  class_id?: string;
  academic_year_id?: string;
  status?: EnrollmentStatus;
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
    nis: string;
    full_name: string;
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
  created_at: string;
  updated_at: string;
};

export function toEnrollmentResponse(
  enrollment: EnrollmentWithRelations,
): EnrollmentResponse {
  return {
    id: enrollment.id,
    student: {
      id: enrollment.student.id,
      nis: enrollment.student.nis,
      full_name: enrollment.student.person.full_name,
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
    created_at: enrollment.created_at.toISOString(),
    updated_at: enrollment.updated_at.toISOString(),
  };
}

export function toEnrollmentAuditSnapshot(
  enrollment: StudentClassEnrollment,
): AuditValue {
  return {
    student_id: enrollment.student_id,
    academic_year_id: enrollment.academic_year_id,
    class_id: enrollment.class_id,
    grade_level: enrollment.grade_level,
    class_name_snapshot: enrollment.class_name_snapshot,
    enrollment_status: enrollment.enrollment_status,
    start_date: enrollment.start_date
      ? enrollment.start_date.toISOString()
      : null,
    end_date: enrollment.end_date ? enrollment.end_date.toISOString() : null,
  };
}
