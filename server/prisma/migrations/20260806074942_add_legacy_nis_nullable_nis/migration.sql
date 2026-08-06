-- Support legacy imports whose old NIS doesn't match the current strict
-- pattern: nis becomes nullable, legacy_nis preserves the raw historical
-- value. The unique index on nis already permits multiple NULLs, so no
-- index changes are needed.

ALTER TABLE "students" ALTER COLUMN "nis" DROP NOT NULL;
ALTER TABLE "students" ADD COLUMN "legacy_nis" TEXT;
