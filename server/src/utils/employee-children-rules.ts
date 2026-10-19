import { ChildRelation, MaritalStatus } from "../generated/prisma/client";

// Rules for the children an employee has. Only the birth date and the relation are kept; every number is worked out
// from them for the day it is asked, so nothing goes stale when a child turns 23.

// A biological parent is at least this many years older than the child.
export const MIN_PARENT_AGE_GAP_YEARS = 18;
// More than this is a typing mistake.
export const MAX_CHILDREN = 20;
// A child counts for the allowance until the day they turn this age.
export const ALLOWANCE_AGE_LIMIT = 23;

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
