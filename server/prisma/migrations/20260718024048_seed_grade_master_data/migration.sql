-- Grade levels are fixed reference/master data (like MasterUnit,
-- MasterJobPosition, MasterJobLevel), seeded once here rather than exposed
-- through an admin CRUD API. Kindergarten sub-levels (Pre-K/K1/K2) are kept
-- as distinct rows with negative `level` values so "Grade N" keeps the
-- simple invariant level = N, and no grade-level information is lost the
-- way it was in the legacy spreadsheet data (which collapsed all
-- Kindergarten sub-levels into one generic "Kindergarten" class label).
--
-- Explicit stable ids are used (instead of relying on Prisma's client-side
-- cuid()) since these rows are permanent, well-known reference data.
INSERT INTO "grades" ("id", "name", "level") VALUES
  ('grade_kindergarten_pre_k', 'Kindergarten Pre-K', -3),
  ('grade_kindergarten_k1', 'Kindergarten K1', -2),
  ('grade_kindergarten_k2', 'Kindergarten K2', -1),
  ('grade_1', 'Grade 1', 1),
  ('grade_2', 'Grade 2', 2),
  ('grade_3', 'Grade 3', 3),
  ('grade_4', 'Grade 4', 4),
  ('grade_5', 'Grade 5', 5),
  ('grade_6', 'Grade 6', 6),
  ('grade_7', 'Grade 7', 7),
  ('grade_8', 'Grade 8', 8),
  ('grade_9', 'Grade 9', 9)
ON CONFLICT (name) DO NOTHING;