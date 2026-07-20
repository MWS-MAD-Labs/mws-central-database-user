import type {
  Gender,
  Grade,
  Person,
  Religion,
  Student,
  StudentStatus,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreateStudentRequest = {
  full_name: string;
  nick_name: string;
  email: string;
  gender: Gender;
  religion: Religion;
  birth_place: string;
  birth_date: string;
  photo_url?: string;

  nis: string;
  nisn?: string;
  status?: StudentStatus;
  current_grade_id: string;
  join_academic_year_id: string;
  join_grade_id: string;
  previous_school?: string;
};

export type GetStudentRequest = {
  id: string;
};

export type StudentResponse = {
  id: string;
  person_id: string;

  identity: {
    full_name: string;
    nick_name: string;
    email: string;
  };

  academic: {
    nis: string;
    nisn: string | null;
    current_grade: string;
    join_academic_year_id: string;
    join_grade: string;
    previous_school: string | null;
  };

  status: StudentStatus;
  created_at: string;
};

export type StudentDetailResponse = Omit<StudentResponse, "identity" | "academic"> & {
  identity: StudentResponse["identity"] & {
    gender: Gender;
    religion: Religion;
    birth_place: string;
    birth_date: string;
    photo_url: string | null;
  };
  academic: StudentResponse["academic"] & {
    current_class_id: string | null;
    graduation_grade: string | null;
    leave_year: string | null;
    sn: string | null;
  };
};

export type StudentWithGrades = Student & {
  current_grade: Grade;
  join_grade: Grade;
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
    },

    academic: {
      nis: student.nis,
      nisn: student.nisn,
      current_grade: student.current_grade.name,
      join_academic_year_id: student.join_academic_year_id,
      join_grade: student.join_grade.name,
      previous_school: student.previous_school,
    },

    status: student.status,
    created_at: student.created_at.toISOString(),
  };
}

export function toStudentDetailResponse(
  person: PersonWithStudent,
): StudentDetailResponse {
  const baseResponse = toStudentResponse(person);
  const student = person.student!;

  return {
    ...baseResponse,
    identity: {
      ...baseResponse.identity,
      gender: person.gender,
      religion: person.religion,
      birth_place: person.birth_place,
      birth_date: person.birth_date.toISOString(),
      photo_url: person.photo_url,
    },
    academic: {
      ...baseResponse.academic,
      current_class_id: student.current_class_id,
      graduation_grade: student.graduation_grade,
      leave_year: student.leave_year,
      sn: student.sn,
    },
  };
}

// Raw-field snapshot for audit old_values/new_values — keeps the underlying
// grade IDs (not resolved names) so the audit trail stays meaningful even if
// a grade's name changes later.
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
    birth_place: person.birth_place,
    birth_date: person.birth_date.toISOString(),
    nis: student.nis,
    nisn: student.nisn,
    status: student.status,
    current_grade_id: student.current_grade_id,
    join_academic_year_id: student.join_academic_year_id,
    join_grade_id: student.join_grade_id,
    previous_school: student.previous_school,
  };
}
