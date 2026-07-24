import type {
  Class,
  ConsentRecord,
  ConsentStatus,
  ConsentType,
  Grade,
  Person,
  Student,
  StudentClassEnrollment,
  StudentStatus,
} from "../generated/prisma/client";

export type StudentLookupRequest = {
  nis?: string;
  email?: string;
};

export type StudentListRequest = {
  page: number;
  size: number;
  status?: StudentStatus;
  current_grade_id?: string;
  current_class_id?: string;
  academic_year_id?: string;
};

// Deliberately leaner than the admin-facing StudentResponse: only what a
// consuming app needs to provision an account / render a basic profile.
// No birth date, gender, religion, address, parents, health, etc.
export type StudentLookupResponse = {
  id: string;
  nis: string;
  nisn: string | null;
  full_name: string;
  nick_name: string;
  email: string;
  status: StudentStatus;
  current_grade: string;
  current_class: string | null;
};

export type StudentLookupPerson = Person & {
  student:
    | (Student & {
        current_grade: Grade;
        current_class: Class | null;
      })
    | null;
};

export function toStudentLookupResponse(
  person: StudentLookupPerson,
): StudentLookupResponse {
  const student = person.student!;

  return {
    id: student.id,
    nis: student.nis,
    nisn: student.nisn,
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    status: student.status,
    current_grade: student.current_grade.name,
    current_class: student.current_class?.name ?? null,
  };
}

// Enrollment history: same idea as the lookup response, leaner than the
// admin-facing EnrollmentResponse - no internal FK IDs, just what a
// consuming app needs to know which class/year a student was in and when.
export type StudentAcademicHistoryEntry = {
  academic_year: string;
  grade_level: string;
  class_name: string;
  enrollment_status: string;
  start_date: string | null;
  end_date: string | null;
};

export type EnrollmentWithNames = StudentClassEnrollment & {
  academic_year: { name: string };
};

export function toStudentAcademicHistoryEntry(
  enrollment: EnrollmentWithNames,
): StudentAcademicHistoryEntry {
  return {
    academic_year: enrollment.academic_year.name,
    grade_level: enrollment.grade_level,
    class_name: enrollment.class_name_snapshot,
    enrollment_status: enrollment.enrollment_status,
    start_date: enrollment.start_date
      ? enrollment.start_date.toISOString()
      : null,
    end_date: enrollment.end_date ? enrollment.end_date.toISOString() : null,
  };
}

// Health: minimal fields only, same fields an admin-panel Viewer without
// can_view_sensitive_data would never see either.
export type StudentHealthResponse = {
  blood_type: string | null;
  needs_assistance: boolean;
  notes: Array<{
    category: string;
    description: string;
    status: string;
  }>;
};

// Consent status only, no attachment metadata - a consuming app checking
// "has this been signed" doesn't need the file itself.
export type StudentConsentStatusEntry = {
  consent_type: ConsentType;
  status: ConsentStatus;
};

export function toStudentConsentStatusEntry(
  consent: ConsentRecord,
): StudentConsentStatusEntry {
  return {
    consent_type: consent.consent_type,
    status: consent.status,
  };
}
