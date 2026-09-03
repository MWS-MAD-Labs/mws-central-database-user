-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ROLLBACK_PC_ACTIVITY_MENTOR_MUTATION';

-- CreateTable
CREATE TABLE "pc_activity_mentor_mutation_histories" (
    "id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "mentor_id" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "previous_history_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pc_activity_mentor_mutation_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Partial (scoped to deleted_at IS NULL), not plain - see
-- 20260827050000_partial_unique_previous_history_id_excludes_deleted's
-- comment on the employee/student equivalents. A plain unique index would
-- let a soft-deleted row's previous_history_id permanently block that value
-- from ever being claimed again after the first rollback on this
-- (activity, unit) pair.
CREATE UNIQUE INDEX "pc_activity_mentor_mutation_histories_previous_history_id_key" ON "pc_activity_mentor_mutation_histories"("previous_history_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "pc_activity_mentor_mutation_histories" ADD CONSTRAINT "pc_activity_mentor_mutation_histories_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "master_pc_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_mentor_mutation_histories" ADD CONSTRAINT "pc_activity_mentor_mutation_histories_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_mentor_mutation_histories" ADD CONSTRAINT "pc_activity_mentor_mutation_histories_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pc_activity_mentor_mutation_histories" ADD CONSTRAINT "pc_activity_mentor_mutation_histories_previous_history_id_fkey" FOREIGN KEY ("previous_history_id") REFERENCES "pc_activity_mentor_mutation_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
