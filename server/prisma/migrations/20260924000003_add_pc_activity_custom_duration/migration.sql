ALTER TYPE "PcActivityRoomDurationType" ADD VALUE IF NOT EXISTS 'CUSTOM';

ALTER TABLE "pc_activity_rooms"
ADD COLUMN IF NOT EXISTS "custom_duration_days" INTEGER;

ALTER TABLE "pc_activity_rooms"
ADD CONSTRAINT "pc_activity_rooms_custom_duration_days_check"
CHECK (
  ("duration_type" = 'CUSTOM' AND "custom_duration_days" IS NOT NULL AND "custom_duration_days" > 0)
  OR
  ("duration_type" <> 'CUSTOM' AND "custom_duration_days" IS NULL)
);
