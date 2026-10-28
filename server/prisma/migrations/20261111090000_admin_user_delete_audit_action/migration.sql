-- A Super Admin can delete a deactivated admin that never left a trace.
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_ADMIN_USER';
