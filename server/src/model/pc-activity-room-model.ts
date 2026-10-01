import type {
  AcademicYear,
  Class,
  Employee,
  Grade,
  Intern,
  MasterPCActivity,
  MasterUnit,
  PcActivityAssignmentStatus,
  PcActivityMentorAssignmentStatus,
  PcActivityRoom,
  PcActivityRoomDurationType,
  PcActivityRoomGrade,
  PcActivityRoomClass,
  PcActivityRoomMentorAssignment,
  PcActivityRoomUnit,
  PCDay,
  Person,
} from "../generated/prisma/client";

export const PC_ACTIVITY_ROOM_SORT_FIELDS = ["created_at", "day"] as const;
export const PC_ACTIVITY_ROOM_STUDENT_SORT_FIELDS = [
  "student_name",
  "nis",
  "start_date",
  "expires_at",
  "status",
] as const;
export const PC_ACTIVITY_ROOM_MENTOR_SORT_FIELDS = [
  "mentor_name",
  "mentor_type",
  "job_position",
  "start_date",
  "status",
] as const;
export const PC_ACTIVITY_ROOM_ELIGIBLE_SORT_FIELDS = ["name", "type"] as const;
export type PcActivityRoomSortField =
  (typeof PC_ACTIVITY_ROOM_SORT_FIELDS)[number];

export type ListPcActivityRoomsRequest = {
  page: number;
  size: number;
  search?: string;
  activity_id?: string;
  academic_year_id?: string;
  sort_by?: PcActivityRoomSortField;
  sort_order?: "asc" | "desc";
};

export type CreatePcActivityRoomRequest = {
  label?: string;
  activity_id: string;
  academic_year_id?: string;
  day: PCDay;
  duration_type: PcActivityRoomDurationType;
  custom_duration_days?: number;
  unit_ids: string[];
  // Empty allows any grade within the selected units.
  grade_ids?: string[];
  // Empty allows any eligible class in the selected academic year.
  class_ids?: string[];
};

export type UpdatePcActivityRoomRequest = {
  id: string;
  label?: string | null;
  duration_type?: PcActivityRoomDurationType;
  custom_duration_days?: number | null;
  unit_ids?: string[];
  grade_ids?: string[];
  class_ids?: string[];
};

export type GetPcActivityRoomRequest = {
  id: string;
};

export type DeletePcActivityRoomRequest = {
  id: string;
};

export type PcActivityRoomMentorSummary = {
  assignment_id: string;
  id: string;
  name: string;
  type: "EMPLOYEE" | "INTERN";
};

export type PcActivityRoomResponse = {
  id: string;
  label: string | null;
  display_name: string;
  activity_id: string;
  activity_name: string;
  academic_year_id: string;
  academic_year_name: string;
  day: PCDay;
  duration_type: PcActivityRoomDurationType;
  custom_duration_days: number | null;
  start_date: string;
  end_date: string;
  units: { id: string; name: string }[];
  grades: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  mentors: PcActivityRoomMentorSummary[];
  // Counts only ACTIVE, non-deleted assignments - see PassionConnectionActivity.status.
  student_count: number;
  scheduled_count: number;
  expired_count: number;
  created_at: string;
  updated_at: string;
};

type PcActivityRoomWithRelations = PcActivityRoom & {
  activity: MasterPCActivity;
  academic_year: AcademicYear;
  units: (PcActivityRoomUnit & { unit: MasterUnit })[];
  grades: (PcActivityRoomGrade & { grade: Grade })[];
  classes: (PcActivityRoomClass & { class: Class })[];
  mentors: (PcActivityRoomMentorAssignment & {
    employee: (Employee & { person: Person }) | null;
    intern: Intern | null;
  })[];
  student_counts?: Partial<Record<PcActivityAssignmentStatus, number>>;
};

export function toPcActivityRoomResponse(
  room: PcActivityRoomWithRelations,
): PcActivityRoomResponse {
  return {
    id: room.id,
    label: room.label,
    display_name: room.label ? `${room.activity.name} - ${room.label}` : room.activity.name,
    activity_id: room.activity_id,
    activity_name: room.activity.name,
    academic_year_id: room.academic_year_id,
    academic_year_name: room.academic_year.name,
    day: room.day,
    duration_type: room.duration_type,
    custom_duration_days: room.custom_duration_days,
    start_date: room.start_date.toISOString(),
    end_date: room.end_date.toISOString(),
    units: room.units.map((u) => ({ id: u.unit.id, name: u.unit.name })),
    grades: room.grades.map((g) => ({ id: g.grade.id, name: g.grade.name })),
    classes: room.classes.map((entry) => ({ id: entry.class.id, name: entry.class.name })),
    mentors: room.mentors
      .filter((m) => m.status === "ACTIVE" && m.deleted_at === null)
      .map((m) =>
        m.employee
          ? {
              assignment_id: m.id,
              id: m.employee.id,
              name: m.employee.person.full_name,
              type: "EMPLOYEE" as const,
            }
          : {
              assignment_id: m.id,
              id: m.intern!.id,
              name: m.intern!.full_name,
              type: "INTERN" as const,
            },
      ),
    student_count: room.student_counts?.ACTIVE ?? 0,
    scheduled_count: room.student_counts?.SCHEDULED ?? 0,
    expired_count: room.student_counts?.EXPIRED ?? 0,
    created_at: room.created_at.toISOString(),
    updated_at: room.updated_at.toISOString(),
  };
}

export type AssignPcActivityRoomMentorRequest = {
  room_id: string;
  employee_id?: string;
  intern_id?: string;
  start_date?: string;
};

export type BulkAssignPcActivityRoomMentorsRequest = {
  room_id: string;
  start_date?: string;
  targets: { employee_id?: string; intern_id?: string; start_date?: string }[];
};

export type EndPcActivityRoomMentorAssignmentRequest = {
  id: string;
  room_id: string;
};

export type RemovePcActivityRoomMentorAssignmentRequest = {
  id: string;
  room_id: string;
};

export type ReopenPcActivityRoomMentorAssignmentRequest = {
  id: string;
  room_id: string;
};

export type MovePcActivityRoomMentorAssignmentRequest = {
  id: string;
  room_id: string;
  target_room_id: string;
};

export type BulkEndPcActivityRoomMentorAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
};

export type BulkRemovePcActivityRoomMentorAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
};

export type BulkReopenPcActivityRoomMentorAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
};

export type BulkMovePcActivityRoomMentorAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
  target_room_id: string;
};

export type ListPcActivityRoomMentorsRequest = {
  room_id: string;
  page: number;
  size: number;
  search?: string;
  status?: PcActivityMentorAssignmentStatus;
  sort_by?: (typeof PC_ACTIVITY_ROOM_MENTOR_SORT_FIELDS)[number];
  sort_order?: "asc" | "desc";
};

export type ListPcActivityRoomEligibleMentorsRequest = {
  room_id: string;
  page: number;
  size: number;
  search?: string;
  sort_by?: (typeof PC_ACTIVITY_ROOM_ELIGIBLE_SORT_FIELDS)[number];
  sort_order?: "asc" | "desc";
};

export type PcActivityRoomEligibleMentorResponse = {
  id: string;
  name: string;
  type: "EMPLOYEE" | "INTERN";
  unit_id: string;
};

export type PcActivityRoomMentorAssignmentResponse = {
  id: string;
  room_id: string;
  mentor_id: string;
  mentor_name: string;
  mentor_type: "EMPLOYEE" | "INTERN";
  job_position_name: string | null;
  unit_name: string | null;
  start_date: string;
  end_date: string | null;
  status: PcActivityMentorAssignmentStatus;
  deleted_at: string | null;
};

export type PcActivityRoomMentorshipHistoryResponse = {
  id: string;
  room_id: string;
  room_name: string;
  activity_name: string;
  academic_year_name: string;
  day: PCDay;
  start_date: string;
  end_date: string | null;
  status: PcActivityMentorAssignmentStatus;
};

export function toPcActivityRoomMentorAssignmentResponse(
  assignment: PcActivityRoomMentorAssignment & {
    employee:
      | (Employee & {
          person: Person;
          unit?: { name: string } | null;
          job_position?: { name: string } | null;
        })
      | null;
    intern:
      | (Intern & {
          unit?: { name: string } | null;
          job_position?: { name: string } | null;
        })
      | null;
  },
): PcActivityRoomMentorAssignmentResponse {
  return {
    id: assignment.id,
    room_id: assignment.room_id,
    mentor_id: assignment.employee?.id ?? assignment.intern!.id,
    mentor_name: assignment.employee?.person.full_name ?? assignment.intern!.full_name,
    mentor_type: assignment.employee ? "EMPLOYEE" : "INTERN",
    job_position_name:
      assignment.employee?.job_position?.name ?? assignment.intern?.job_position?.name ?? null,
    unit_name: assignment.employee?.unit?.name ?? assignment.intern?.unit?.name ?? null,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
    status: assignment.status,
    deleted_at: assignment.deleted_at ? assignment.deleted_at.toISOString() : null,
  };
}

export type BulkAssignPcActivityRoomStudentsRequest = {
  room_id: string;
  student_ids: string[];
  start_date?: string;
};

export type ListPcActivityRoomEligibleStudentsRequest = {
  room_id: string;
  page: number;
  size: number;
  search?: string;
  grade_id?: string;
  available_only?: boolean;
};

export type PcActivityRoomEligibleStudentResponse = {
  student_id: string;
  full_name: string;
  nis: string | null;
  class_name: string | null;
  grade_name: string;
  already_assigned: boolean;
  other_activity: {
    assignment_id: string;
    activity_name: string;
    day: PCDay;
    room_id: string | null;
    // True when the other assignment occupies this room's day and blocks
    // a new assignment until it is ended or reassigned.
    same_day: boolean;
  } | null;
  // EXACT: a legacy row (room_id null) already matches this room's
  // activity and day - assigning just tags it with this room, no
  // supersede. DAY_ONLY: same day, different activity - a real conflict,
  // needs a manual reassignment, never bulk-attached. NONE: no conflict.
  legacy_match: "EXACT" | "DAY_ONLY" | "NONE";
};

export type ListPcActivityRoomStudentsRequest = {
  room_id: string;
  page: number;
  size: number;
  search?: string;
  status?: PcActivityAssignmentStatus;
  sort_by?: (typeof PC_ACTIVITY_ROOM_STUDENT_SORT_FIELDS)[number];
  sort_order?: "asc" | "desc";
};

export type PcActivityRoomStudentResponse = {
  id: string;
  student_id: string;
  student_name: string;
  nis: string | null;
  // The student's current class for the room's academic year, independent
  // of still_eligible - shown even when they've moved out of this room's
  // scope, so it's clear where they actually are now.
  class_name: string | null;
  grade_name: string | null;
  day: PCDay;
  status: PcActivityAssignmentStatus;
  start_date: string;
  expires_at: string | null;
  end_date: string | null;
  deleted_at: string | null;
  // False once the student has left every one of this room's grades/units
  // (promoted, transferred, etc.) - surfaced, never auto-removed.
  still_eligible: boolean;
};

export type EndPcActivityRoomStudentAssignmentRequest = {
  room_id: string;
  assignment_id: string;
};

export type DropPcActivityRoomStudentAssignmentRequest = {
  room_id: string;
  assignment_id: string;
};

export type ReopenPcActivityRoomStudentAssignmentRequest = {
  room_id: string;
  assignment_id: string;
};

export type MovePcActivityRoomStudentRequest = {
  room_id: string;
  assignment_id: string;
  target_room_id: string;
};

export type ReassignPcActivityRoomStudentRequest = {
  room_id: string;
  student_id: string;
  source_assignment_id: string;
};

export type BulkEndPcActivityRoomStudentAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
};

export type BulkDropPcActivityRoomStudentAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
};

export type BulkReopenPcActivityRoomStudentAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
};

export type BulkMovePcActivityRoomStudentAssignmentsRequest = {
  room_id: string;
  assignment_ids: string[];
  target_room_id: string;
};

export type UpdatePcActivityRoomAssignmentStartDateRequest = {
  room_id: string;
  assignment_id: string;
  start_date: string;
};

export type BulkUpdatePcActivityRoomAssignmentStartDatesRequest = {
  room_id: string;
  assignment_ids: string[];
  start_date: string;
};
