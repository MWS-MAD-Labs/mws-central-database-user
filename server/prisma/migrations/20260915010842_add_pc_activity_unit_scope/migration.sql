-- CreateTable
CREATE TABLE "master_pc_activity_units" (
    "activity_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "master_pc_activity_units_pkey" PRIMARY KEY ("activity_id","unit_id")
);

-- AddForeignKey
ALTER TABLE "master_pc_activity_units" ADD CONSTRAINT "master_pc_activity_units_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "master_pc_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_pc_activity_units" ADD CONSTRAINT "master_pc_activity_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "master_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
