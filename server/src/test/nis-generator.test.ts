import { describe, afterEach, it, expect } from "bun:test";
import { StudentTest, GradeTest, AcademicYearTest } from "./test-utils";
import { StudentEntryType } from "../generated/prisma/client";
import { computeNisPrefix, generateNis } from "../utils/nis-generator";

describe("computeNisPrefix", () => {
  it("derives Kindergarten (unit 0) + PRE_K (entry type 0)", () => {
    const prefix = computeNisPrefix({
      academicYear: { name: "2026/2027", start_date: new Date("2026-07-01") },
      gradeLevel: -1,
      entryType: StudentEntryType.PRE_K,
    });
    expect(prefix).toBe("2600");
  });

  it("derives Elementary (unit 1) + PSB (entry type 1)", () => {
    const prefix = computeNisPrefix({
      academicYear: { name: "2026/2027", start_date: new Date("2026-07-01") },
      gradeLevel: 3,
      entryType: StudentEntryType.PSB,
    });
    expect(prefix).toBe("2611");
  });

  it("derives Junior High (unit 2) + TRANSFER (entry type 2)", () => {
    const prefix = computeNisPrefix({
      academicYear: { name: "2026/2027", start_date: new Date("2026-07-01") },
      gradeLevel: 8,
      entryType: StudentEntryType.TRANSFER,
    });
    expect(prefix).toBe("2622");
  });

  it("falls back to a 4-digit year in the name when start_date is unset", () => {
    const prefix = computeNisPrefix({
      academicYear: { name: "Legacy Year 2019/2020", start_date: null },
      gradeLevel: 1,
      entryType: StudentEntryType.PSB,
    });
    expect(prefix).toBe("1911");
  });

  it("throws for a grade level outside Kindergarten/Elementary/Junior High", () => {
    expect(() =>
      computeNisPrefix({
        academicYear: { name: "2026/2027", start_date: new Date("2026-07-01") },
        gradeLevel: 10,
        entryType: StudentEntryType.PSB,
      }),
    ).toThrow();
  });
});

describe("generateNis", () => {
  afterEach(async () => {
    await StudentTest.delete();
    await GradeTest.delete();
    await AcademicYearTest.delete();
  });

  it("allocates sequence 001 for a prefix with no existing students", async () => {
    const nis = await generateNis({
      academicYear: { name: "2099/2100", start_date: new Date("2099-07-01") },
      gradeLevel: 1,
      entryType: StudentEntryType.PSB,
    });
    expect(nis).toBe("9911001");
  });

  it("allocates the next number after a consecutive run", async () => {
    const academicYear = { name: "2098/2099", start_date: new Date("2098-07-01") };
    await StudentTest.create({
      email: "test_nisgen_seq1@millennia21.id",
      nis: "9811001",
    });
    await StudentTest.create({
      email: "test_nisgen_seq2@millennia21.id",
      nis: "9811002",
    });

    const nis = await generateNis({
      academicYear,
      gradeLevel: 1,
      entryType: StudentEntryType.PSB,
    });
    expect(nis).toBe("9811003");
  });

  it("fills a gap instead of jumping past the highest existing nis", async () => {
    const academicYear = { name: "2097/2098", start_date: new Date("2097-07-01") };
    // A legacy-import NIS that already matched the pattern can land far
    // ahead of the real sequence - the generator must not waste every
    // number below it.
    await StudentTest.create({
      email: "test_nisgen_gap@millennia21.id",
      nis: "9711900",
    });

    const nis = await generateNis({
      academicYear,
      gradeLevel: 1,
      entryType: StudentEntryType.PSB,
    });
    expect(nis).toBe("9711001");
  });

  it("skips only the numbers actually taken, not a whole contiguous block", async () => {
    const academicYear = { name: "2096/2097", start_date: new Date("2096-07-01") };
    await StudentTest.create({
      email: "test_nisgen_holes1@millennia21.id",
      nis: "9611001",
    });
    await StudentTest.create({
      email: "test_nisgen_holes2@millennia21.id",
      nis: "9611003",
    });

    const nis = await generateNis({
      academicYear,
      gradeLevel: 1,
      entryType: StudentEntryType.PSB,
    });
    expect(nis).toBe("9611002");
  });

  it("keeps prefixes for different grade/entry-type combos independent", async () => {
    const academicYear = { name: "2095/2096", start_date: new Date("2095-07-01") };
    await StudentTest.create({
      email: "test_nisgen_indep1@millennia21.id",
      nis: "9511001",
    });

    // Same year, different grade unit (Junior High instead of Elementary) -
    // must not be affected by the Elementary allocation above.
    const nis = await generateNis({
      academicYear,
      gradeLevel: 8,
      entryType: StudentEntryType.PSB,
    });
    expect(nis).toBe("9521001");
  });
});
