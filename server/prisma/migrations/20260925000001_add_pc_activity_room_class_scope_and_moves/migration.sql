ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DROP_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REOPEN_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MOVE_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MOVE_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT';

CREATE TABLE "pc_activity_room_classes" (
    "room_id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    CONSTRAINT "pc_activity_room_classes_pkey" PRIMARY KEY ("room_id", "class_id")
);

ALTER TABLE "pc_activity_room_classes" ADD CONSTRAINT "pc_activity_room_classes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "pc_activity_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pc_activity_room_classes" ADD CONSTRAINT "pc_activity_room_classes_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "passion_connection_activities" ADD COLUMN "previous_assignment_id" TEXT;
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_previous_assignment_id_fkey" FOREIGN KEY ("previous_assignment_id") REFERENCES "passion_connection_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "passion_connection_activities_previous_assignment_id_key" ON "passion_connection_activities"("previous_assignment_id");

ALTER TABLE "pc_activity_room_mentor_assignments" ADD COLUMN "previous_assignment_id" TEXT;
ALTER TABLE "pc_activity_room_mentor_assignments" ADD CONSTRAINT "pc_activity_room_mentor_assignments_previous_assignment_id_fkey" FOREIGN KEY ("previous_assignment_id") REFERENCES "pc_activity_room_mentor_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pc_activity_room_mentor_assignments_previous_assignment_id_key" ON "pc_activity_room_mentor_assignments"("previous_assignment_id");
