ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_PC_ACTIVITY_ROOM_MENTOR_START_DATE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_PC_ACTIVITY_ROOM_STUDENT_START_DATE';

CREATE INDEX "pc_activity_room_mentor_assignments_room_id_deleted_at_status_start_date_idx"
ON "pc_activity_room_mentor_assignments"("room_id", "deleted_at", "status", "start_date");

CREATE INDEX "pc_activity_room_mentor_assignments_employee_id_deleted_at_status_idx"
ON "pc_activity_room_mentor_assignments"("employee_id", "deleted_at", "status");

CREATE INDEX "pc_activity_room_mentor_assignments_intern_id_deleted_at_status_idx"
ON "pc_activity_room_mentor_assignments"("intern_id", "deleted_at", "status");

CREATE INDEX "passion_connection_activities_room_id_deleted_at_status_start_date_idx"
ON "passion_connection_activities"("room_id", "deleted_at", "status", "start_date");
