-- Rolling back a mutation-history entry (EmployeeMutationHistoryService.rollback /
-- StudentMutationHistoryService.rollback) soft-deletes the row instead of
-- removing it, so its previous_history_id value stays physically present in
-- the table. A plain UNIQUE index doesn't know the row is dead: the very next
-- edit to that field tries to reuse the same previous_history_id (the record
-- it's now chaining onto again) and hits a unique constraint violation -
-- permanently, since the "poisoned" value never frees up. Reproduced against
-- a real employee record: roll a field back to its genesis entry, then try to
-- change that field again - every attempt fails the same way.
--
-- Scoping the index to deleted_at IS NULL is what actually matches the
-- invariant the app relies on ("the chain's tip has at most one live
-- successor") - a dead row's previous_history_id should be free for a new
-- live row to claim, the same value.
--
-- schema.prisma still declares `previous_history_id String? @unique` on both
-- models (kept so Prisma generates the one-to-one relation shape -
-- next_history: X? instead of X[] - that the app code depends on). Prisma's
-- own drift detection has no notion of a partial index and will want to
-- recreate a plain one here on a future `prisma migrate dev` for either
-- table. Don't let it - regenerate this migration's WHERE clause instead.
DROP INDEX "employee_mutation_histories_previous_history_id_key";
CREATE UNIQUE INDEX "employee_mutation_histories_previous_history_id_key" ON "employee_mutation_histories"("previous_history_id") WHERE "deleted_at" IS NULL;

DROP INDEX "student_mutation_histories_previous_history_id_key";
CREATE UNIQUE INDEX "student_mutation_histories_previous_history_id_key" ON "student_mutation_histories"("previous_history_id") WHERE "deleted_at" IS NULL;
