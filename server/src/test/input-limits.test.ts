import { describe, expect, it } from "bun:test";
import { LIMITS } from "../constants/limits";
import { AcademicYearValidation } from "../validation/academic-year-validation";
import { ClassValidation } from "../validation/class-validation";
import { GradeValidation } from "../validation/grade-validation";
import { JobLevelValidation } from "../validation/job-level-validation";
import { JobPositionValidation } from "../validation/job-position-validation";
import { PCActivityMasterValidation } from "../validation/pc-activity-validation";
import { SimpleMasterDataValidation } from "../validation/simple-master-data-validation";

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe("input limits", () => {
  it("keeps master data names to 50 characters", () => {
    const edge = "a".repeat(LIMITS.MASTER_NAME_MAX);
    const over = "a".repeat(LIMITS.MASTER_NAME_MAX + 1);
    for (const schema of [
      SimpleMasterDataValidation.CREATE,
      JobLevelValidation.CREATE,
      JobPositionValidation.CREATE,
      PCActivityMasterValidation.CREATE,
    ]) {
      expect(accepts(schema, { name: edge })).toBe(true);
      expect(accepts(schema, { name: over })).toBe(false);
    }
  });

  it("limits how many people may hold a job position", () => {
    const base = { name: "Teacher", capacity_scope: "GLOBAL" };
    expect(accepts(JobPositionValidation.CREATE, { ...base, max_active_holders: LIMITS.JOB_POSITION_HOLDERS_MAX })).toBe(true);
    expect(accepts(JobPositionValidation.CREATE, { ...base, max_active_holders: LIMITS.JOB_POSITION_HOLDERS_MAX + 1 })).toBe(false);
  });

  it("limits class name and capacity", () => {
    const base = { grade_id: "g", academic_year_id: "y" };
    expect(accepts(ClassValidation.CREATE, { ...base, name: "a".repeat(LIMITS.CLASS_NAME_MAX), capacity: LIMITS.CLASS_CAPACITY_MAX })).toBe(true);
    expect(accepts(ClassValidation.CREATE, { ...base, name: "a".repeat(LIMITS.CLASS_NAME_MAX + 1) })).toBe(false);
    expect(accepts(ClassValidation.CREATE, { ...base, name: "A", capacity: LIMITS.CLASS_CAPACITY_MAX + 1 })).toBe(false);
    expect(accepts(ClassValidation.CREATE, { ...base, name: "A", capacity: 0 })).toBe(false);
  });

  it("limits grade name, level and typical age", () => {
    const ok = { name: "Grade 1", level: 1, typical_age: 7 };
    expect(accepts(GradeValidation.CREATE, ok)).toBe(true);
    // The grades the school really has: Pre-K is level -3 and starts at age 3.
    expect(accepts(GradeValidation.CREATE, { name: "Kindergarten Pre-K", level: -3, typical_age: 3 })).toBe(true);
    expect(accepts(GradeValidation.CREATE, { ...ok, name: "a".repeat(LIMITS.GRADE_NAME_MAX + 1) })).toBe(false);
    expect(accepts(GradeValidation.CREATE, { ...ok, level: LIMITS.GRADE_LEVEL_MAX + 1 })).toBe(false);
    expect(accepts(GradeValidation.CREATE, { ...ok, level: LIMITS.GRADE_LEVEL_MIN - 1 })).toBe(false);
    expect(accepts(GradeValidation.CREATE, { ...ok, typical_age: LIMITS.GRADE_AGE_MAX + 1 })).toBe(false);
    expect(accepts(GradeValidation.CREATE, { ...ok, typical_age: LIMITS.GRADE_AGE_MIN - 1 })).toBe(false);
  });

  it("keeps academic years to sane years", () => {
    const dates = { start_date: "2026-07-01T00:00:00.000Z", end_date: "2027-06-30T00:00:00.000Z" };
    expect(accepts(AcademicYearValidation.CREATE, { name: "2026/2027", ...dates })).toBe(true);
    expect(accepts(AcademicYearValidation.CREATE, { name: "202753445455445", ...dates })).toBe(false);
    expect(accepts(AcademicYearValidation.CREATE, { name: "1999/2000", ...dates })).toBe(false);
    expect(accepts(AcademicYearValidation.CREATE, { name: "2101/2102", ...dates })).toBe(false);
    expect(accepts(AcademicYearValidation.CREATE, { name: "2026/2027", start_date: "1900-01-01T00:00:00.000Z" })).toBe(false);
    expect(accepts(AcademicYearValidation.CREATE, { name: "2026/2027", start_date: "2026-07-01T00:00:00.000Z", end_date: "9999-01-01T00:00:00.000Z" })).toBe(false);
    expect(accepts(AcademicYearValidation.BULK_CREATE, { start_year: 2026, end_year: 2030 })).toBe(true);
    expect(accepts(AcademicYearValidation.BULK_CREATE, { start_year: 2026, end_year: 9999 })).toBe(false);
  });
});
