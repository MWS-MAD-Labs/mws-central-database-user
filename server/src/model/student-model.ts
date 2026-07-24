import type {
  ConsentStatus,
  Gender,
  Grade,
  PCDay,
  Person,
  Prisma,
  Religion,
  Student,
  StudentStatus,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

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
  pickup_drop_service?: boolean;
  catering_service?: boolean;
  psb_guide?: boolean;
};

export type UpdateStudentRequest = {
  id: string;

  full_name?: string;
  nick_name?: string;
  email?: string;
  gender?: Gender;
  religion?: Religion;
  birth_place?: string;
  birth_date?: string;
  photo_url?: string;

  nis?: string;
  nisn?: string;
  status?: StudentStatus;
  current_grade_id?: string;
  join_academic_year_id?: string;
  join_grade_id?: string;
  previous_school?: string;
  graduation_grade?: string;
  leave_year?: string;
  sn?: string;
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

export type StudentDetailResponse = Omit<
  StudentResponse,
  "identity" | "academic"
> & {
  identity: StudentResponse["identity"] & {
    birth_place: string;
    birth_date: string;
    photo_url: string | null;
  };
  academic: StudentResponse["academic"] & {
    current_class_id: string | null;
    graduation_grade: string | null;
    leave_year: string | null;
    sn: string | null;
    pickup_drop_service: boolean;
    catering_service: boolean;
    psb_guide: boolean;
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
      gender: person.gender,
      religion: person.religion,
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
      pickup_drop_service: student.pickup_drop_service,
      catering_service: student.catering_service,
      psb_guide: student.psb_guide,
    },
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
    birth_place: person.birth_place,
    birth_date: person.birth_date.toISOString(),
    nis: student.nis,
    nisn: student.nisn,
    status: student.status,
    current_grade_id: student.current_grade_id,
    join_academic_year_id: student.join_academic_year_id,
    join_grade_id: student.join_grade_id,
    previous_school: student.previous_school,
    graduation_grade: student.graduation_grade,
    leave_year: student.leave_year,
    sn: student.sn,
    pickup_drop_service: student.pickup_drop_service,
    catering_service: student.catering_service,
    psb_guide: student.psb_guide,
  };
}
