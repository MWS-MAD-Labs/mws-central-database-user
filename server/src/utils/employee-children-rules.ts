import { ChildRelation, MaritalStatus } from "../generated/prisma/client";

// Rules for the children an employee has. Only the birth date and the relation are kept; every number is worked out
// from them for the day it is asked, so nothing goes stale when a child turns 23.

// A biological parent is at least this many years older than the child.
export const MIN_PARENT_AGE_GAP_YEARS = 18;
// More than this is a typing mistake.
export const MAX_CHILDREN = 20;
// A child counts for the allowance until the day they turn this age.
export const ALLOWANCE_AGE_LIMIT = 23;

// Numbers typed in for a parent who does not share birth dates. They cannot age, so they are reviewed after this long.
export const COUNTS_REVIEW_AFTER_MONTHS = 12;

export type ChildrenCounts = { under_23: number; age_23_plus: number; adopted: number };

export type ChildDraft = { birth_date: Date; relation: ChildRelation };

export type ChildrenSummary = {
  total: number;
  under_23: number;
  age_23_plus: number;
  // The children who count for the allowance today. Central only reports the number.
  allowance_eligible: number;
};

const toUtcDate = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

// Whole years from `birth` to `on`; the birthday itself counts.
export function ageOn(birth: Date, on: Date): number {
  const from = toUtcDate(birth);
  const to = toUtcDate(on);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const beforeBirthday =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
}

function addYears(date: Date, years: number): Date {
  const base = toUtcDate(date);
  return new Date(Date.UTC(base.getUTCFullYear() + years, base.getUTCMonth(), base.getUTCDate()));
}

export function summarizeChildren(
  children: Pick<ChildDraft, "birth_date">[],
  today: Date = new Date(),
): ChildrenSummary {
  const under = children.filter((child) => ageOn(child.birth_date, today) < ALLOWANCE_AGE_LIMIT).length;
  return {
    total: children.length,
    under_23: under,
    age_23_plus: children.length - under,
    allowance_eligible: under,
  };
}

const iso = (date: Date) => toUtcDate(date).toISOString().slice(0, 10);

// Everything wrong with this list of children for this employee, in plain words. Empty means it is fine.
export function findChildrenProblems(input: {
  marital_status: MaritalStatus;
  parent_birth_date: Date;
  children: ChildDraft[];
  today?: Date;
}): string[] {
  const today = input.today ?? new Date();
  const problems: string[] = [];

  if (input.children.length > MAX_CHILDREN) {
    problems.push(`An employee can have at most ${MAX_CHILDREN} children on record`);
  }

  input.children.forEach((child, index) => {
    const label = `Child ${index + 1} (born ${iso(child.birth_date)})`;

    if (toUtcDate(child.birth_date) > toUtcDate(today)) {
      problems.push(`${label} cannot be born in the future`);
      return;
    }

    if (input.marital_status === MaritalStatus.SINGLE && child.relation !== ChildRelation.ADOPTED) {
      problems.push(
        `${label} cannot be a ${child.relation === ChildRelation.STEP ? "step" : "biological"} child of an employee who is single. Only an adopted child can be recorded`,
      );
      return;
    }

    if (child.relation === ChildRelation.BIOLOGICAL) {
      if (toUtcDate(child.birth_date) < addYears(input.parent_birth_date, MIN_PARENT_AGE_GAP_YEARS)) {
        problems.push(
          `${label} must be at least ${MIN_PARENT_AGE_GAP_YEARS} years younger than the employee (born ${iso(input.parent_birth_date)})`,
        );
      }
      return;
    }

    if (toUtcDate(child.birth_date) <= toUtcDate(input.parent_birth_date)) {
      problems.push(`${label} must be younger than the employee (born ${iso(input.parent_birth_date)})`);
    }
  });

  return problems;
}

export function summarizeCounts(counts: ChildrenCounts): ChildrenSummary {
  return {
    total: counts.under_23 + counts.age_23_plus,
    under_23: counts.under_23,
    age_23_plus: counts.age_23_plus,
    allowance_eligible: counts.under_23,
  };
}

// Typed numbers are stale once they have not been confirmed for a year.
export function countsNeedReview(declaredAt: Date, today: Date = new Date()): boolean {
  const limit = toUtcDate(declaredAt);
  limit.setUTCMonth(limit.getUTCMonth() + COUNTS_REVIEW_AFTER_MONTHS);
  return toUtcDate(today) > limit;
}

// Same idea as findChildrenProblems, with only the three numbers to go on. A child who is not adopted is taken as
// biological, so the oldest ones still need a parent old enough.
export function findCountsProblems(input: {
  marital_status: MaritalStatus;
  parent_birth_date: Date;
  counts: ChildrenCounts;
  today?: Date;
}): string[] {
  const today = input.today ?? new Date();
  const { under_23, age_23_plus, adopted } = input.counts;
  const total = under_23 + age_23_plus;
  const problems: string[] = [];

  if (total > MAX_CHILDREN) {
    problems.push(`An employee can have at most ${MAX_CHILDREN} children on record`);
  }
  if (adopted > total) {
    problems.push("Adopted children cannot be more than the children in total");
    return problems;
  }
  if (input.marital_status === MaritalStatus.SINGLE && adopted < total) {
    problems.push("An employee who is single can only have adopted children on record");
    return problems;
  }

  // At least this many of the children aged 23 or older are not adopted.
  const olderNotAdopted = Math.max(0, age_23_plus - adopted);
  const minParentAge = ALLOWANCE_AGE_LIMIT + MIN_PARENT_AGE_GAP_YEARS;
  if (olderNotAdopted > 0 && ageOn(input.parent_birth_date, today) < minParentAge) {
    problems.push(
      `Children aged ${ALLOWANCE_AGE_LIMIT} or older who are not adopted need a parent of at least ${minParentAge} (the employee was born ${iso(input.parent_birth_date)})`,
    );
  }
  return problems;
}
