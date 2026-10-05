import {
  ApplicationAudience,
  EmployeeStatus,
  PersonType,
  StudentStatus,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";

export type RuleFilter = {
  audience: ApplicationAudience;
  unit_ids: string[];
  job_position_ids: string[];
  job_level_ids: string[];
};

export type GateRule = RuleFilter & {
  id: string;
  default_role_key: string;
  is_active: boolean;
};

export type RuleSubject =
  | { kind: "EMPLOYEE"; unitId: string; positionId: string; levelId: string }
  | { kind: "STUDENT"; unitId: string | null };

// How narrow a rule is. The weights are distinct powers of two, so two rules
// with different filters never tie.
export function ruleSpecificity(rule: RuleFilter): number {
  return (
    (rule.job_position_ids.length > 0 ? 4 : 0) +
    (rule.job_level_ids.length > 0 ? 2 : 0) +
    (rule.unit_ids.length > 0 ? 1 : 0)
  );
}

const SUBJECT_SELECT = {
  person_type: true,
  employee: {
    select: { status: true, deleted_at: true, unit_id: true, job_position_id: true, job_level_id: true },
  },
  student: {
    select: { status: true, deleted_at: true, current_grade: { select: { unit_id: true } } },
  },
} as const;

type SubjectPerson = {
  person_type: PersonType;
  employee: {
    status: EmployeeStatus;
    deleted_at: Date | null;
    unit_id: string;
    job_position_id: string;
    job_level_id: string;
  } | null;
  student: {
    status: StudentStatus;
    deleted_at: Date | null;
    current_grade: { unit_id: string | null } | null;
  } | null;
};

// Only active employees and active students can receive group access.
export function toRuleSubject(person: SubjectPerson | null): RuleSubject | null {
  if (!person) return null;
  if (person.person_type === PersonType.EMPLOYEE) {
    const employee = person.employee;
    if (!employee || employee.status !== EmployeeStatus.ACTIVE || employee.deleted_at !== null) return null;
    return {
      kind: "EMPLOYEE",
      unitId: employee.unit_id,
      positionId: employee.job_position_id,
      levelId: employee.job_level_id,
    };
  }
  if (person.person_type === PersonType.STUDENT) {
    const student = person.student;
    if (!student || student.status !== StudentStatus.ACTIVE || student.deleted_at !== null) return null;
    return { kind: "STUDENT", unitId: student.current_grade?.unit_id ?? null };
  }
  return null;
}

export async function loadRuleSubject(personId: string): Promise<RuleSubject | null> {
  const person = await prismaClient.person.findFirst({
    where: { id: personId, deleted_at: null },
    select: SUBJECT_SELECT,
  });
  return toRuleSubject(person);
}

export function ruleMatches(rule: RuleFilter, subject: RuleSubject): boolean {
  const has = (ids: string[], id: string | null) => ids.length === 0 || (id !== null && ids.includes(id));
  if (subject.kind === "EMPLOYEE") {
    return (
      rule.audience !== ApplicationAudience.STUDENTS &&
      has(rule.unit_ids, subject.unitId) &&
      has(rule.job_position_ids, subject.positionId) &&
      has(rule.job_level_ids, subject.levelId)
    );
  }
  return rule.audience !== ApplicationAudience.EMPLOYEES && has(rule.unit_ids, subject.unitId);
}

// Does an audience include everyone of the target audience?
function audienceIncludes(audience: ApplicationAudience, target: ApplicationAudience): boolean {
  return audience === ApplicationAudience.EMPLOYEES_AND_STUDENTS || audience === target;
}

function dimensionCovers(outer: string[], inner: string[]): boolean {
  return outer.length === 0 || (inner.length > 0 && inner.every((id) => outer.includes(id)));
}

// Whether everyone matched by `inner` is also matched by `outer`.
export function covers(outer: RuleFilter, inner: RuleFilter): boolean {
  if (!audienceIncludes(outer.audience, inner.audience)) return false;
  if (!dimensionCovers(outer.unit_ids, inner.unit_ids)) return false;
  // Job position and level only exist for employees.
  if (inner.audience !== ApplicationAudience.STUDENTS) {
    if (!dimensionCovers(outer.job_position_ids, inner.job_position_ids)) return false;
    if (!dimensionCovers(outer.job_level_ids, inner.job_level_ids)) return false;
  }
  return true;
}

// The most specific other rule that covers this one.
export function parentRule(target: GateRule, rules: GateRule[]): GateRule | undefined {
  return rules
    .filter((rule) => rule.is_active && rule.id !== target.id && covers(rule, target))
    .sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left))[0];
}

export function inheritedRole(subject: RuleSubject, rules: GateRule[]): GateRule | undefined {
  return rules
    .filter((rule) => rule.is_active && ruleMatches(rule, subject))
    .sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left))[0];
}

export async function loadActiveRules(applicationId: string): Promise<GateRule[]> {
  const rules = await prismaClient.applicationAccessRule.findMany({
    where: { application_id: applicationId, is_active: true },
  });
  return rules.map((rule) => ({
    id: rule.id,
    audience: rule.audience,
    unit_ids: rule.unit_ids,
    job_position_ids: rule.job_position_ids,
    job_level_ids: rule.job_level_ids,
    default_role_key: rule.default_role_key,
    is_active: rule.is_active,
  }));
}

// A person's own role has to differ from what they already get from groups.
export async function assertPersonNotRedundant(
  applicationId: string,
  personId: string,
  role: string,
  rules: GateRule[],
): Promise<void> {
  const subject = await loadRuleSubject(personId);
  if (!subject) return;
  const inherited = inheritedRole(subject, rules);
  if (inherited && inherited.default_role_key === role) {
    throw new ResponseError(
      400,
      `This person already gets ${role} on ${applicationId} from group access. Pick a different role, or leave them on the group.`,
    );
  }
}

type EntitlementSubject = { role: string; isActive: boolean; subject: RuleSubject | null };

async function loadEntitlementSubjects(applicationId: string): Promise<EntitlementSubject[]> {
  const rows = await prismaClient.applicationEntitlement.findMany({
    where: { application_id: applicationId },
    select: { role: true, is_active: true, person: { select: SUBJECT_SELECT } },
  });
  return rows.map((row) => ({
    role: row.role,
    isActive: row.is_active,
    subject: toRuleSubject(row.person),
  }));
}

// Checks one change of a group access (create, update or delete) against the
// "no redundant access, parent removed last" rules. `previous` is the stored
// rule (null when creating), `next` the rule afterwards (null when deleting).
export async function assertRuleGate(
  applicationId: string,
  previous: GateRule | null,
  next: GateRule | null,
): Promise<void> {
  const before = await loadActiveRules(applicationId);
  const withoutThis = before.filter((rule) => rule.id !== previous?.id);
  const after = next && next.is_active ? [...withoutThis, next] : withoutThis;

  // A group may not hand out the role its parent group already hands out.
  if (next && next.is_active) {
    const parent = parentRule(next, after);
    if (parent && parent.default_role_key === next.default_role_key) {
      throw new ResponseError(
        400,
        `This group already gets ${next.default_role_key} from a broader group access. Pick a different role.`,
      );
    }
  }

  const people = await loadEntitlementSubjects(applicationId);

  // Widening a group must not make narrower access redundant.
  if (next && next.is_active) {
    let redundantGroups = 0;
    let redundantPeople = 0;
    for (const rule of after) {
      if (rule.id === next.id) continue;
      const nowRedundant = parentRule(rule, after)?.default_role_key === rule.default_role_key;
      const wasRedundant =
        before.some((existing) => existing.id === rule.id) &&
        parentRule(rule, before)?.default_role_key === rule.default_role_key;
      if (nowRedundant && !wasRedundant) redundantGroups += 1;
    }
    for (const person of people) {
      if (!person.isActive || !person.subject) continue;
      const nowRedundant = inheritedRole(person.subject, after)?.default_role_key === person.role;
      const wasRedundant = inheritedRole(person.subject, before)?.default_role_key === person.role;
      if (nowRedundant && !wasRedundant) redundantPeople += 1;
    }
    if (redundantGroups + redundantPeople > 0) {
      throw new ResponseError(
        400,
        `${redundantPeople} people and ${redundantGroups} groups already have ${next.default_role_key} inside this group. Remove them first.`,
      );
    }
  }

  // A group cannot go while specific access still has it as its parent.
  if (previous) {
    let dependents = 0;
    for (const rule of before) {
      if (rule.id === previous.id) continue;
      if (parentRule(rule, before)?.id === previous.id && parentRule(rule, after)?.id !== previous.id) {
        dependents += 1;
      }
    }
    for (const person of people) {
      if (!person.subject) continue;
      if (inheritedRole(person.subject, before)?.id === previous.id && inheritedRole(person.subject, after)?.id !== previous.id) {
        dependents += 1;
      }
    }
    if (dependents > 0) {
      throw new ResponseError(
        400,
        `${dependents} specific access entries still depend on this group. Remove them first.`,
      );
    }
  }
}
