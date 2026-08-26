import type {
  AcademicYear,
  Class,
  ClassTeacherAssignment,
  ClassTeacherRole,
  ConsentRecord,
  ConsentStatus,
  Employee,
  Gender,
  Grade,
  HealthNote,
  HealthRecord,
  ParentGuardian,
  PassionConnectionActivity,
  Person,
  Religion,
  Student,
  StudentClassEnrollment,
} from "../generated/prisma/client";
import {
  ConsentType,
  HealthNoteCategory,
  ParentType,
  PCDay,
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
  nis: string | null;
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

// Current class's active homeroom/subject teachers - for a consuming app
// to offer as "talk to your teacher" contacts. Leaner than the admin-facing
// teacher-assignment response: just enough to identify + contact them.
export type StudentSupportContactsResponse = {
  current_class: string | null;
  teachers: {
    name: string;
    email: string;
    role: ClassTeacherRole;
    subject: string | null;
  }[];
};

export type ClassTeacherAssignmentWithEmployee = ClassTeacherAssignment & {
  employee: Employee & { person: Person };
};

export function toStudentSupportContactsResponse(
  currentClassName: string | null,
  assignments: ClassTeacherAssignmentWithEmployee[],
): StudentSupportContactsResponse {
  return {
    current_class: currentClassName,
    teachers: assignments.map((a) => ({
      name: a.employee.person.full_name,
      email: a.employee.person.email,
      role: a.role,
      subject: a.subject,
    })),
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

// Flat, one-row-per-student roster export - built to match the old
// report-card Google Sheet's column shape (via a scheduled Apps Script
// pull, see students:roster_export:read) rather than mirroring our own
// relational responses. Deliberately bundles fields the other student-api
// endpoints keep behind separate scopes (health, parent contact, consent) -
// that's why this needs its own scope rather than reusing STUDENTS_READ.
export type StudentRosterExportRequest = {
  status?: StudentStatus;
};

export type StudentRosterExportRow = {
  nis: string | null;
  legacy_nis: string | null;
  nisn: string | null;
  photo_url: string | null;
  full_name: string;
  nick_name: string;
  gender: Gender;
  status: StudentStatus;
  email: string;
  // Null unless status is ACTIVE - matches the old sheet's "Current grade
  // (If Active)" / implied-active Class Name columns rather than always
  // showing the (still-live) current_grade/current_class FK values.
  current_grade: string | null;
  current_class: string | null;
  join_academic_year: string;
  join_grade: string;
  leave_year: string | null;
  graduation_grade: string | null;
  sn: string | null;
  previous_school: string | null;
  religion: Religion;
  religion_other: string | null;
  birth_place: string;
  birth_date: string;
  father_name: string | null;
  mother_name: string | null;
  father_phone: string | null;
  father_email: string | null;
  mother_phone: string | null;
  mother_email: string | null;
  // From whichever parent is flagged is_primary, falling back to
  // Father then Mother when no parent is marked primary.
  address: string | null;
  health_information: string | null;
  blood_type: string | null;
  special_needs: string | null;
  // Null means no consent record exists for this student at all - a
  // real ConsentStatus (including a non-SIGNED one like PENDING/
  // DECLINED) means central actually has an answer, even if it isn't
  // "yes". Collapsing this to a plain boolean would make "not yet
  // migrated into central" and "explicitly declined" look identical.
  media_consent_status: ConsentStatus | null;
  parent_consent_status: ConsentStatus | null;
  pc_monday: string | null;
  pc_tuesday: string | null;
  pc_wednesday: string | null;
  pc_thursday: string | null;
};

export type StudentRosterExportPerson = Person & {
  student: Student & {
    current_grade: Grade;
    current_class: Class | null;
    join_academic_year: AcademicYear;
    join_grade: Grade;
    parents: ParentGuardian[];
    health: HealthRecord | null;
    health_notes: HealthNote[];
    consents: ConsentRecord[];
    pc: (PassionConnectionActivity & { activity: { name: string } })[];
  };
};

function findParentByType(parents: ParentGuardian[], type: ParentType) {
  return parents.find((parent) => parent.type === type) ?? null;
}

function joinHealthNoteDescriptions(
  notes: HealthNote[],
  category: HealthNoteCategory,
): string | null {
  const descriptions = notes
    .filter((note) => note.category === category)
    .map((note) => note.description);
  return descriptions.length > 0 ? descriptions.join("; ") : null;
}

function pcActivityNameForDay(
  activities: (PassionConnectionActivity & { activity: { name: string } })[],
  day: PCDay,
): string | null {
  return activities.find((a) => a.day === day)?.activity.name ?? null;
}

export function toStudentRosterExportRow(
  person: StudentRosterExportPerson,
  photoUrl: string | null,
): StudentRosterExportRow {
  const student = person.student;
  const isActive = student.status === StudentStatus.ACTIVE;
  const father = findParentByType(student.parents, ParentType.FATHER);
  const mother = findParentByType(student.parents, ParentType.MOTHER);
  const primaryParent =
    student.parents.find((parent) => parent.is_primary) ?? father ?? mother;
  const mediaConsent = student.consents.find(
    (consent) => consent.consent_type === ConsentType.MEDIA_CONSENT,
  );
  const parentConsent = student.consents.find(
    (consent) => consent.consent_type === ConsentType.PARENT_CONSENT,
  );

  return {
    nis: student.nis,
    legacy_nis: student.legacy_nis,
    nisn: student.nisn,
    photo_url: photoUrl,
    full_name: person.full_name,
    nick_name: person.nick_name,
    gender: person.gender,
    status: student.status,
    email: person.email,
    current_grade: isActive ? student.current_grade.name : null,
    current_class: isActive ? (student.current_class?.name ?? null) : null,
    join_academic_year: student.join_academic_year.name,
    join_grade: student.join_grade.name,
    leave_year: student.leave_year,
    graduation_grade: student.graduation_grade,
    sn: student.sn,
    previous_school: student.previous_school,
    religion: person.religion,
    religion_other: person.religion_other,
    birth_place: person.birth_place,
    birth_date: person.birth_date.toISOString(),
    father_name: father?.full_name ?? null,
    mother_name: mother?.full_name ?? null,
    father_phone: father?.phone ?? null,
    father_email: father?.email ?? null,
    mother_phone: mother?.phone ?? null,
    mother_email: mother?.email ?? null,
    address: primaryParent?.address ?? null,
    health_information: joinHealthNoteDescriptions(
      student.health_notes,
      HealthNoteCategory.HEALTH_INFO,
    ),
    blood_type: student.health?.blood_type ?? null,
    special_needs: joinHealthNoteDescriptions(
      student.health_notes,
      HealthNoteCategory.SPECIAL_NEEDS,
    ),
    media_consent_status: mediaConsent?.status ?? null,
    parent_consent_status: parentConsent?.status ?? null,
    pc_monday: pcActivityNameForDay(student.pc, PCDay.MONDAY),
    pc_tuesday: pcActivityNameForDay(student.pc, PCDay.TUESDAY),
    pc_wednesday: pcActivityNameForDay(student.pc, PCDay.WEDNESDAY),
    pc_thursday: pcActivityNameForDay(student.pc, PCDay.THURSDAY),
  };
}
