import { describe, expect, it } from "bun:test";
import { ChildRelation, MaritalStatus } from "../generated/prisma/client";
import {
  ageOn,
  findChildrenProblems,
  MAX_CHILDREN,
  summarizeChildren,
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
