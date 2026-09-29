-- PC Activities move from "a class offers an activity" to a standalone
-- Room scoped to unit(s) + grade(s), independent of any single class.
-- This migration creates the new room tables, backfills them from the
-- existing per-class offerings (class_passion_connection_activities),
-- repoints student assignments at rooms, and retires the old table.
-- Mirrors the earlier one-per-year fix's "backfill then swap
-- constraints" shape (see 20260923000004_fix_pc_activity_one_per_year).

-- CreateEnum
CREATE TYPE "PcActivityRoomDurationType" AS ENUM ('SIX_MONTHS', 'HALF_SEMESTER', 'SEMESTER', 'FULL_YEAR');

-- CreateEnum
CREATE TYPE "PcActivityAssignmentStatus" AS ENUM ('ACTIVE', 'EXPIRED');

-- AlterEnum (new audit actions for the room-based flow)
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_PC_ACTIVITY_ROOM';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_PC_ACTIVITY_ROOM';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_PC_ACTIVITY_ROOM';
ALTER TYPE "AuditAction" ADD VALUE 'BULK_ASSIGN_PC_ACTIVITY_ROOM_STUDENTS';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGN_PC_ACTIVITY_ROOM_MENTOR';
ALTER TYPE "AuditAction" ADD VALUE 'END_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE 'REMOVE_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE 'REOPEN_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE 'AUTO_EXPIRE_PC_ACTIVITY_ASSIGNMENT';

ALTER TABLE "master_job_positions" ADD COLUMN "is_pc_mentor_eligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_job_levels" ADD COLUMN "is_pc_mentor_eligible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pc_activity_rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "activity_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "day" "PCDay" NOT NULL,
    "duration_type" "PcActivityRoomDurationType" NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pc_activity_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pc_activity_room_units" (
    "room_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "pc_activity_room_units_pkey" PRIMARY KEY ("room_id","unit_id")
);

-- CreateTable
CREATE TABLE "pc_activity_room_grades" (
    "room_id" TEXT NOT NULL,
    "grade_id" TEXT NOT NULL,

    CONSTRAINT "pc_activity_room_grades_pkey" PRIMARY KEY ("room_id","grade_id")
);

-- CreateTable
CREATE TABLE "pc_activity_room_mentor_assignments" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "intern_id" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pc_activity_room_mentor_assignments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "pc_activity_rooms" ADD CONSTRAINT "pc_activity_rooms_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "master_pc_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pc_activity_rooms" ADD CONSTRAINT "pc_activity_rooms_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_room_units" ADD CONSTRAINT "pc_activity_room_units_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "pc_activity_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pc_activity_room_units" ADD CONSTRAINT "pc_activity_room_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_room_grades" ADD CONSTRAINT "pc_activity_room_grades_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "pc_activity_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pc_activity_room_grades" ADD CONSTRAINT "pc_activity_room_grades_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_room_mentor_assignments" ADD CONSTRAINT "pc_activity_room_mentor_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "pc_activity_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pc_activity_room_mentor_assignments" ADD CONSTRAINT "pc_activity_room_mentor_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pc_activity_room_mentor_assignments" ADD CONSTRAINT "pc_activity_room_mentor_assignments_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one of employee_id/intern_id - same convention as
-- pc_activity_default_mentors (not "at most one" like the old mutation
-- history table, since every row here represents one real mentor).
ALTER TABLE "pc_activity_room_mentor_assignments" ADD CONSTRAINT "pc_activity_room_mentor_assignments_one_workforce_member_check" CHECK (("employee_id" IS NOT NULL AND "intern_id" IS NULL) OR ("employee_id" IS NULL AND "intern_id" IS NOT NULL));

-- Backfill: one room per existing live class offering, reusing the same
-- id so passion_connection_activities.class_activity_id values keep
-- pointing at a valid row without a lookup table. Default every
-- backfilled room to FULL_YEAR duration - the safest "we don't actually
-- know, don't expire anything surprising" choice; nothing in the old
-- model recorded an intended duration.
INSERT INTO "pc_activity_rooms" ("id", "activity_id", "academic_year_id", "day", "duration_type", "created_by", "created_at", "updated_at", "deleted_at")
SELECT "id", "activity_id", "academic_year_id", "day", 'FULL_YEAR', "created_by", "created_at", "created_at", "deleted_at"
FROM "class_passion_connection_activities";

-- Backfill each room's unit from the originating class's own grade/unit -
-- scope isn't left silently "any unit." Grade scope is left empty (any
-- grade within that unit) since the old model had no grade-level
-- scoping to preserve.
INSERT INTO "pc_activity_room_units" ("room_id", "unit_id")
SELECT DISTINCT cpa."id", g."unit_id"
FROM "class_passion_connection_activities" cpa
JOIN "classes" c ON c."id" = cpa."class_id"
JOIN "grades" g ON g."id" = c."grade_id"
ON CONFLICT DO NOTHING;

-- Backfill mentors: seed each room's first mentor assignment from
-- whatever was the unit's default mentor for that activity, so mentor
-- history doesn't start empty. start_date matches the room's own
-- created_at.
INSERT INTO "pc_activity_room_mentor_assignments" ("id", "room_id", "employee_id", "intern_id", "start_date")
SELECT gen_random_uuid()::text, cpa."id", dm."mentor_id", dm."intern_id", cpa."created_at"
FROM "class_passion_connection_activities" cpa
JOIN "classes" c ON c."id" = cpa."class_id"
JOIN "grades" g ON g."id" = c."grade_id"
JOIN "pc_activity_default_mentors" dm ON dm."activity_id" = cpa."activity_id" AND dm."unit_id" = g."unit_id";

-- AlterTable
ALTER TABLE "passion_connection_activities" ADD COLUMN "room_id" TEXT;
ALTER TABLE "passion_connection_activities" ADD COLUMN "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "passion_connection_activities" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "passion_connection_activities" ADD COLUMN "status" "PcActivityAssignmentStatus" NOT NULL DEFAULT 'ACTIVE';

-- Repoint existing student assignments at the backfilled rooms. Rows with
-- no class_activity_id (the old per-student flow, never tied to a class
-- offering) become unscoped legacy assignments: room_id stays null,
-- expires_at stays null - never invent an expiry for something with no
-- room/duration to compute it from, surfaced as-is for an admin to
-- migrate into a real room at their own pace.
UPDATE "passion_connection_activities"
SET "room_id" = "class_activity_id", "start_date" = "created_at"
WHERE "class_activity_id" IS NOT NULL;

-- DropIndex (was "one row per student per year ever" - too strict now
-- that an EXPIRED assignment should free the student for a new room the
-- same year)
DROP INDEX "pc_activities_student_year_active_key";

-- CreateIndex (partial - one *current* room per student per year: an
-- EXPIRED row drops out of this uniqueness scope while staying queryable
-- as history)
CREATE UNIQUE INDEX "pc_activities_student_year_current_key" ON "passion_connection_activities"("student_id", "academic_year_id") WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';

-- DropForeignKey
ALTER TABLE "passion_connection_activities" DROP CONSTRAINT "passion_connection_activities_class_activity_id_fkey";

-- AlterTable
ALTER TABLE "passion_connection_activities" DROP COLUMN "class_activity_id";

-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "pc_activity_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The old class offering is superseded by rooms. Legacy suggestion/scope
-- tables remain readable during transition but are no longer used by the UI.
DROP TABLE "class_passion_connection_activities";
