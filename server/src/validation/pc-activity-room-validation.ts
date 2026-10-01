import { z } from "zod";
import {
  PcActivityAssignmentStatus,
  PcActivityMentorAssignmentStatus,
  PcActivityRoomDurationType,
} from "../generated/prisma/client";
import { PC_DAY_VALUES } from "./pc-activity-validation";
import {
  PC_ACTIVITY_ROOM_ELIGIBLE_SORT_FIELDS,
  PC_ACTIVITY_ROOM_MENTOR_SORT_FIELDS,
  PC_ACTIVITY_ROOM_SORT_FIELDS,
  PC_ACTIVITY_ROOM_STUDENT_SORT_FIELDS,
} from "../model/pc-activity-room-model";

const PAGE = z.number().int().min(1).default(1);
const SIZE = z.number().int().min(1).max(100).default(10);
const ISO_DATE = z.iso.datetime();

const DURATION_TYPE_VALUES = Object.keys(PcActivityRoomDurationType) as [
  keyof typeof PcActivityRoomDurationType,
  ...(keyof typeof PcActivityRoomDurationType)[],
];

export class PcActivityRoomValidation {
  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    activity_id: z.string().min(1).optional(),
    academic_year_id: z.string().min(1).optional(),
    sort_by: z.enum(PC_ACTIVITY_ROOM_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });

  static readonly CREATE = z.object({
    label: z.string().min(1).max(100).optional(),
    activity_id: z.string().min(1, "PC Activity ID is required"),
    academic_year_id: z.string().min(1, "Academic year ID cannot be empty").optional(),
    day: z.enum(PC_DAY_VALUES, { message: "Day must be a valid format" }),
    duration_type: z.enum(DURATION_TYPE_VALUES, {
      message: "Duration type must be a valid format",
    }),
    custom_duration_days: z.number().int().positive().optional(),
    unit_ids: z
      .array(z.string().min(1))
      .min(1, "A room needs at least one unit"),
    grade_ids: z
      .array(z.string().min(1))
      .min(1, "A room needs at least one grade"),
    class_ids: z
      .array(z.string().min(1))
      .min(1, "A room needs at least one class")
      .optional(),
  }).superRefine((data, context) => {
    if (data.duration_type === "CUSTOM" && !data.custom_duration_days) {
      context.addIssue({ code: "custom", message: "Custom duration days are required", path: ["custom_duration_days"] });
    }
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC Activity room ID is required"),
    label: z.string().min(1).max(100).nullable().optional(),
    duration_type: z
      .enum(DURATION_TYPE_VALUES, { message: "Duration type must be a valid format" })
      .optional(),
    custom_duration_days: z.number().int().positive().nullable().optional(),
    unit_ids: z
      .array(z.string().min(1))
      .min(1, "A room needs at least one unit")
      .optional(),
    grade_ids: z
      .array(z.string().min(1))
      .min(1, "A room needs at least one grade")
      .optional(),
    class_ids: z
      .array(z.string().min(1))
      .min(1, "A room needs at least one class")
      .optional(),
  });

  static readonly GET = z.object({
    id: z.string().min(1, "PC Activity room ID is required"),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "PC Activity room ID is required"),
  });

  static readonly LIST_MENTORS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    page: PAGE,
    size: SIZE,
    search: z.string().optional(),
    status: z.enum(PcActivityMentorAssignmentStatus).optional(),
    sort_by: z.enum(PC_ACTIVITY_ROOM_MENTOR_SORT_FIELDS).default("start_date"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
  });

  static readonly LIST_ELIGIBLE_MENTORS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    page: PAGE,
    size: SIZE,
    search: z.string().optional(),
    sort_by: z.enum(PC_ACTIVITY_ROOM_ELIGIBLE_SORT_FIELDS).default("name"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
  });

  static readonly LIST_ELIGIBLE_STUDENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    page: PAGE,
    size: SIZE,
    search: z.string().optional(),
    grade_id: z.string().min(1).optional(),
    available_only: z.boolean().default(false),
  });

  static readonly LIST_STUDENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    page: PAGE,
    size: SIZE,
    search: z.string().optional(),
    status: z.enum(PcActivityAssignmentStatus).optional(),
    sort_by: z.enum(PC_ACTIVITY_ROOM_STUDENT_SORT_FIELDS).default("start_date"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
  });

  static readonly ASSIGN_MENTOR = z
    .object({
      room_id: z.string().min(1, "Room ID is required"),
      employee_id: z.string().min(1).optional(),
      intern_id: z.string().min(1).optional(),
      start_date: ISO_DATE.optional(),
    })
    .refine((data) => Boolean(data.employee_id) !== Boolean(data.intern_id), {
      message: "Provide exactly one of employee_id or intern_id",
    });

  static readonly BULK_ASSIGN_MENTORS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    start_date: ISO_DATE.optional(),
    targets: z
      .array(
        z
          .object({
            employee_id: z.string().min(1).optional(),
            intern_id: z.string().min(1).optional(),
            start_date: ISO_DATE.optional(),
          })
          .refine((data) => Boolean(data.employee_id) !== Boolean(data.intern_id), {
            message: "Provide exactly one of employee_id or intern_id",
          }),
      )
      .min(1, "Select at least one mentor")
      .max(50, "Bulk assign can process up to 50 mentors at once"),
  });

  static readonly END_MENTOR_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    room_id: z.string().min(1, "Room ID is required"),
  });

  static readonly REMOVE_MENTOR_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    room_id: z.string().min(1, "Room ID is required"),
  });

  static readonly REOPEN_MENTOR_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    room_id: z.string().min(1, "Room ID is required"),
  });

  static readonly MOVE_MENTOR_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    room_id: z.string().min(1, "Room ID is required"),
    target_room_id: z.string().min(1, "Target room ID is required"),
  });

  static readonly BULK_END_MENTOR_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one mentor assignment")
      .max(100, "Bulk end can process up to 100 assignments at once"),
  });

  static readonly BULK_REMOVE_MENTOR_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one mentor assignment")
      .max(100, "Bulk remove can process up to 100 assignments at once"),
  });

  static readonly BULK_REOPEN_MENTOR_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one mentor assignment")
      .max(100, "Bulk reopen can process up to 100 assignments at once"),
  });

  static readonly BULK_MOVE_MENTOR_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one mentor assignment")
      .max(100, "Bulk move can process up to 100 assignments at once"),
    target_room_id: z.string().min(1, "Target room ID is required"),
  });

  static readonly BULK_ASSIGN_STUDENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    student_ids: z
      .array(z.string().min(1, "Student ID is required"))
      .min(1, "Select at least one student")
      .max(100, "Bulk assign can process up to 100 students at once"),
    start_date: ISO_DATE.optional(),
  });

  static readonly END_STUDENT_ASSIGNMENT = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_id: z.string().min(1, "Assignment ID is required"),
  });

  static readonly DROP_STUDENT_ASSIGNMENT = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_id: z.string().min(1, "Assignment ID is required"),
  });

  static readonly REOPEN_STUDENT_ASSIGNMENT = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_id: z.string().min(1, "Assignment ID is required"),
  });

  static readonly MOVE_STUDENT = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_id: z.string().min(1, "Assignment ID is required"),
    target_room_id: z.string().min(1, "Target room ID is required"),
  });

  static readonly BULK_END_STUDENT_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one student assignment")
      .max(100, "Bulk end can process up to 100 assignments at once"),
  });

  static readonly BULK_DROP_STUDENT_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one student assignment")
      .max(100, "Bulk drop can process up to 100 assignments at once"),
  });

  static readonly BULK_REOPEN_STUDENT_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one student assignment")
      .max(100, "Bulk reopen can process up to 100 assignments at once"),
  });

  static readonly BULK_MOVE_STUDENT_ASSIGNMENTS = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one student assignment")
      .max(100, "Bulk move can process up to 100 assignments at once"),
    target_room_id: z.string().min(1, "Target room ID is required"),
  });

  static readonly REASSIGN_STUDENT = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    source_assignment_id: z.string().min(1, "Source assignment ID is required"),
  });

  static readonly UPDATE_START_DATE = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_id: z.string().min(1, "Assignment ID is required"),
    start_date: ISO_DATE,
  });

  static readonly BULK_UPDATE_START_DATES = z.object({
    room_id: z.string().min(1, "Room ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one assignment")
      .max(100, "Bulk update can process up to 100 assignments at once"),
    start_date: ISO_DATE,
  });
}
