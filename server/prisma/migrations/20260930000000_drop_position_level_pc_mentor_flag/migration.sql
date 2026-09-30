-- PC mentor eligibility is decided by the employee/intern's own flag; the
-- copies on job positions and job levels were never read.
ALTER TABLE "master_job_positions" DROP COLUMN "is_pc_mentor_eligible";
ALTER TABLE "master_job_levels" DROP COLUMN "is_pc_mentor_eligible";
