-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EXTEND_EMPLOYEE_CONTRACT';

-- AlterEnum
ALTER TYPE "EmployeeMutationField" ADD VALUE 'EMPLOYMENT_TYPE';

-- AlterTable
ALTER TABLE "employee_mutation_histories" ADD COLUMN     "employment_type" "EmploymentType";
