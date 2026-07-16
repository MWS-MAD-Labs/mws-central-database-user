-- RenameColumn
-- `can_create_data` renamed to `can_write_data` to reflect that the flag
-- also gates Employee.update(), not just Employee.create(). Uses RENAME
-- instead of DROP+ADD to preserve existing admin permission values.
ALTER TABLE "admin_users" RENAME COLUMN "can_create_data" TO "can_write_data";
