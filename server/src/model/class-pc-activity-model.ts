import type { ClassPassionConnectionActivity, MasterPCActivity, PCDay } from "../generated/prisma/client";

export type ListClassPcActivitiesRequest = {
  class_id: string;
};

export type AssignClassPcActivityRequest = {
  class_id: string;
  activity_id: string;
  day: PCDay;
  academic_year_id?: string;
};

export type RemoveClassPcActivityRequest = {
  id: string;
  class_id: string;
};

export type BulkEnrollClassPcActivityStudentsRequest = {
  class_activity_id: string;
  class_id: string;
  student_ids: string[];
};

export type RosterStatusClassPcActivityRequest = {
  class_activity_id: string;
  class_id: string;
};

export type ListEnrolledStudentsClassPcActivityRequest = {
  class_activity_id: string;
  class_id: string;
};

export type ClassPcActivityEnrolledStudentResponse = {
  id: string;
  student_id: string;
  student_name: string;
  nis: string | null;
  day: PCDay;
  deleted_at: string | null;
  // False once the student has left this offering's class (promoted,
  // transferred, withdrawn, etc.) - surfaced so an admin can decide
  // whether to remove the now-stale enrollment. Nothing is auto-removed.
  still_on_roster: boolean;
};

export type ClassPcActivityRosterStatusResponse = {
  student_id: string;
  // True when this roster student already has an active enrollment in
  // this exact offering.
  already_enrolled: boolean;
  // Set when the student already has a DIFFERENT active PC activity this
  // academic year (any day) - enrolling them here would violate the
  // one-per-student-per-year constraint (pc_activities_student_year_active_key).
  other_activity: {
    activity_name: string;
    day: PCDay;
    class_activity_id: string | null;
  } | null;
};

export type ClassPcActivityOfferingResponse = {
  id: string;
  class_id: string;
  activity_id: string;
  activity_name: string;
  academic_year_id: string;
  day: PCDay;
  // Resolved from the class's unit - null means no default mentor is set
  // for that unit yet.
  mentor_id: string | null;
  mentor_name: string | null;
  mentor_type: "EMPLOYEE" | "INTERN" | null;
  // Counts only students still on this offering's own class roster - a
  // student who's since moved to a different class keeps their enrollment
  // (never auto-removed) but no longer counts here. See
  // ClassPcActivityEnrolledStudentResponse.still_on_roster to find them.
  enrolled_count: number;
  created_at: string;
};

export function toClassPcActivityOfferingResponse(
  record: ClassPassionConnectionActivity & {
    activity: MasterPCActivity;
    student_links: { id: string; student: { current_class_id: string | null } }[];
  },
  mentor: { id: string; name: string; type: "EMPLOYEE" | "INTERN" } | null,
): ClassPcActivityOfferingResponse {
  return {
    id: record.id,
    class_id: record.class_id,
    activity_id: record.activity_id,
    activity_name: record.activity.name,
    academic_year_id: record.academic_year_id,
    day: record.day,
    mentor_id: mentor?.id ?? null,
    mentor_name: mentor?.name ?? null,
    mentor_type: mentor?.type ?? null,
    enrolled_count: record.student_links.filter(
      (link) => link.student.current_class_id === record.class_id,
    ).length,
    created_at: record.created_at.toISOString(),
  };
}
