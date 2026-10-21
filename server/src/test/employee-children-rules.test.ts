import { describe, expect, it } from "bun:test";
import { ChildRelation, MaritalStatus } from "../generated/prisma/client";
import {
  ageOn,
  countsNeedReview,
  DEFAULT_ALLOWANCE_RULE,
  describeChildCount,
  findChildrenProblems,
  findCountsProblems,
  MAX_CHILDREN,
  summarizeChildren,
  summarizeCounts,
  type AllowanceRule,
} from "../utils/employee-children-rules";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const child = (birth: string, relation: ChildRelation = ChildRelation.BIOLOGICAL) => ({
  birth_date: day(birth),
  relation,
});
const today = day("2026-10-28");

describe("ageOn", () => {
  it("counts whole years and turns over on the birthday itself", () => {
    expect(ageOn(day("2003-10-28"), today)).toBe(23);
    expect(ageOn(day("2003-10-29"), today)).toBe(22);
    expect(ageOn(day("2026-10-28"), today)).toBe(0);
  });
});

describe("summarizeChildren", () => {
  it("splits at 23 and turns the child over on the 23rd birthday", () => {
    const summary = summarizeChildren(
      [child("2003-10-28"), child("2003-10-29"), child("2015-01-01"), child("2000-01-01")],
      today,
    );
    expect(summary).toEqual({ total: 4, under_23: 2, age_23_plus: 2, allowance_eligible: 2 });
  });

  it("gives a different answer on a different day without anything being stored", () => {
    const children = [child("2003-10-29")];
    expect(summarizeChildren(children, day("2026-10-28")).under_23).toBe(1);
    expect(summarizeChildren(children, day("2026-10-29")).under_23).toBe(0);
  });

  it("is all zero for no children", () => {
    expect(summarizeChildren([], today)).toEqual({ total: 0, under_23: 0, age_23_plus: 0, allowance_eligible: 0 });
  });
});

describe("findChildrenProblems", () => {
  const check = (parentBirth: string, children: ReturnType<typeof child>[], marital: MaritalStatus = MaritalStatus.MARRIED) =>
    findChildrenProblems({ marital_status: marital, parent_birth_date: day(parentBirth), children, today });

  it("rejects a 20 year old child of a 30 year old", () => {
    const problems = check("1996-10-28", [child("2006-10-28")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("at least 18 years younger");
  });

  it("accepts a biological child exactly 18 years younger and rejects one a day short", () => {
    expect(check("1990-05-10", [child("2008-05-10")])).toEqual([]);
    expect(check("1990-05-10", [child("2008-05-09")])).toHaveLength(1);
  });

  it("rejects a child older than or as old as the parent, for any relation", () => {
    for (const relation of [ChildRelation.BIOLOGICAL, ChildRelation.ADOPTED, ChildRelation.STEP]) {
      expect(check("1990-05-10", [child("1985-01-01", relation)])).toHaveLength(1);
      expect(check("1990-05-10", [child("1990-05-10", relation)])).toHaveLength(1);
    }
  });

  it("lets an adopted or step child be any younger age", () => {
    expect(check("1990-05-10", [child("2000-01-01", ChildRelation.ADOPTED)])).toEqual([]);
    expect(check("1990-05-10", [child("2000-01-01", ChildRelation.STEP)])).toEqual([]);
  });

  it("rejects a child born in the future", () => {
    expect(check("1980-01-01", [child("2027-01-01")])[0]).toContain("future");
  });

  it("lets a single employee have an adopted child only", () => {
    expect(check("1990-05-10", [child("2015-01-01", ChildRelation.ADOPTED)], MaritalStatus.SINGLE)).toEqual([]);
    expect(check("1990-05-10", [child("2015-01-01")], MaritalStatus.SINGLE)[0]).toContain("single");
    expect(check("1990-05-10", [child("2015-01-01", ChildRelation.STEP)], MaritalStatus.SINGLE)[0]).toContain("step");
  });

  it("lets a married, divorced or widowed employee have any kind", () => {
    for (const marital of [MaritalStatus.MARRIED, MaritalStatus.DIVORCED, MaritalStatus.WIDOWED]) {
      expect(check("1980-01-01", [child("2010-01-01"), child("2012-01-01", ChildRelation.STEP)], marital)).toEqual([]);
    }
  });

  it("rejects more children than the limit and names the child that is wrong", () => {
    const many = Array.from({ length: MAX_CHILDREN + 1 }, () => child("2015-01-01"));
    expect(check("1980-01-01", many)[0]).toContain(`at most ${MAX_CHILDREN}`);
    expect(check("1990-05-10", [child("2015-01-01"), child("2006-01-01")])[0]).toContain("Child 2");
  });
});

describe("typed counts", () => {
  const parent = day("1985-01-01"); // 41 on the test day
  const problems = (counts: { under_23: number; age_23_plus: number; adopted: number }, marital: MaritalStatus = MaritalStatus.MARRIED, birth = parent) =>
    findCountsProblems({ marital_status: marital, parent_birth_date: birth, counts, today });

  it("adds up the numbers and counts the under 23s for the allowance", () => {
    expect(summarizeCounts({ under_23: 2, age_23_plus: 1, adopted: 0 })).toEqual({
      total: 3,
      under_23: 2,
      age_23_plus: 1,
      allowance_eligible: 2,
    });
  });

  it("accepts a normal family", () => {
    expect(problems({ under_23: 2, age_23_plus: 1, adopted: 0 })).toEqual([]);
  });

  it("refuses more adopted children than children", () => {
    expect(problems({ under_23: 1, age_23_plus: 0, adopted: 2 })).toHaveLength(1);
  });

  it("lets a single employee have only adopted children", () => {
    expect(problems({ under_23: 2, age_23_plus: 0, adopted: 1 }, MaritalStatus.SINGLE)).toHaveLength(1);
    expect(problems({ under_23: 2, age_23_plus: 0, adopted: 2 }, MaritalStatus.SINGLE)).toEqual([]);
  });

  it("needs a parent of at least 41 for children of 23 or older who are not adopted", () => {
    const young = day("1986-01-01"); // 40
    expect(problems({ under_23: 0, age_23_plus: 1, adopted: 0 }, MaritalStatus.MARRIED, young)).toHaveLength(1);
    expect(problems({ under_23: 0, age_23_plus: 1, adopted: 1 }, MaritalStatus.MARRIED, young)).toEqual([]);
  });

  it("refuses too many children", () => {
    expect(problems({ under_23: MAX_CHILDREN, age_23_plus: 1, adopted: 0 })).not.toHaveLength(0);
  });

  it("asks for a review after a year", () => {
    expect(countsNeedReview(day("2025-10-28"), today)).toBe(false);
    expect(countsNeedReview(day("2025-10-27"), today)).toBe(true);
  });
});

describe("the allowance rule", () => {
  const day = new Date("2026-06-15T00:00:00Z");
  const born = (years: number, relation: ChildRelation = ChildRelation.BIOLOGICAL) => ({
    birth_date: new Date(Date.UTC(2026 - years, 0, 1)),
    relation,
  });
  const rule = (over: Partial<AllowanceRule> = {}): AllowanceRule => ({ ...DEFAULT_ALLOWANCE_RULE, ...over });

  it("stops at the most children that count, however many are young", () => {
    const children = [born(1), born(2), born(3), born(4), born(5)];
    expect(summarizeChildren(children, day).allowance_eligible).toBe(3);
    expect(summarizeChildren(children, day, rule({ max_children: 2 })).allowance_eligible).toBe(2);
    expect(summarizeChildren(children, day, rule({ max_children: null })).allowance_eligible).toBe(5);
    expect(summarizeChildren(children, day).total).toBe(5);
  });

  it("uses its own age limit", () => {
    const children = [born(10), born(20), born(25)];
    expect(summarizeChildren(children, day, rule({ max_children: null, age_limit: 21 })).allowance_eligible).toBe(2);
    expect(summarizeChildren(children, day, rule({ max_children: null, age_limit: 18 })).allowance_eligible).toBe(1);
  });

  it("leaves out the kinds of child that do not count", () => {
    const children = [born(5), born(6, ChildRelation.ADOPTED), born(7, ChildRelation.STEP)];
    const open = rule({ max_children: null });
    expect(summarizeChildren(children, day, open).allowance_eligible).toBe(3);
    expect(summarizeChildren(children, day, { ...open, count_step: false }).allowance_eligible).toBe(2);
    expect(summarizeChildren(children, day, { ...open, count_adopted: false, count_step: false }).allowance_eligible).toBe(1);
  });

  it("applies the same rule to typed numbers", () => {
    const counts = { under_23: 5, age_23_plus: 1, adopted: 2 };
    expect(summarizeCounts(counts).allowance_eligible).toBe(3);
    expect(summarizeCounts(counts, rule({ max_children: null })).allowance_eligible).toBe(5);
    expect(summarizeCounts(counts, rule({ max_children: null, count_adopted: false })).allowance_eligible).toBe(3);
  });

  it("says how many children in a short phrase", () => {
    expect(describeChildCount(0)).toBe("No children");
    expect(describeChildCount(1)).toBe("1 child");
    expect(describeChildCount(4)).toBe("4 children");
  });
});
