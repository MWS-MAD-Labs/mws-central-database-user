-- Backfills typical_age on the grade rows seeded by
-- 20260718024048_seed_grade_master_data (that migration ran before the
-- column existed, so those rows are otherwise stuck at NULL forever).
-- Values are standard Indonesian school-entry ages; the age-vs-grade check
-- in student-service.ts applies a +/-2 year tolerance band around these.
UPDATE "grades" SET "typical_age" = 3 WHERE "id" = 'grade_kindergarten_pre_k';
UPDATE "grades" SET "typical_age" = 4 WHERE "id" = 'grade_kindergarten_k1';
UPDATE "grades" SET "typical_age" = 5 WHERE "id" = 'grade_kindergarten_k2';
UPDATE "grades" SET "typical_age" = 6 WHERE "id" = 'grade_1';
UPDATE "grades" SET "typical_age" = 7 WHERE "id" = 'grade_2';
UPDATE "grades" SET "typical_age" = 8 WHERE "id" = 'grade_3';
UPDATE "grades" SET "typical_age" = 9 WHERE "id" = 'grade_4';
UPDATE "grades" SET "typical_age" = 10 WHERE "id" = 'grade_5';
UPDATE "grades" SET "typical_age" = 11 WHERE "id" = 'grade_6';
UPDATE "grades" SET "typical_age" = 12 WHERE "id" = 'grade_7';
UPDATE "grades" SET "typical_age" = 13 WHERE "id" = 'grade_8';
UPDATE "grades" SET "typical_age" = 14 WHERE "id" = 'grade_9';
