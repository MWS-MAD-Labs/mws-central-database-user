-- Enforce at the database level that at most one academic year can be
-- ACTIVE at a time. The application layer already checks this in
-- academic-year-service.ts, but that check-then-write is not atomic under
-- concurrent requests; this partial unique index is the safety net that
-- makes the invariant hold even under a race.
CREATE UNIQUE INDEX "academic_years_single_active_idx"
ON "academic_years" ("status")
WHERE "status" = 'ACTIVE';
