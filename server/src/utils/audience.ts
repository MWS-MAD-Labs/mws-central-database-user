// Who a group of application access is for. The three kinds are stored as flags, and the API speaks in a list.
export type AudienceName = "EMPLOYEES" | "INTERNS" | "STUDENTS";
export const AUDIENCE_NAMES: readonly AudienceName[] = ["EMPLOYEES", "INTERNS", "STUDENTS"];

export type AudienceFlags = { for_employees: boolean; for_interns: boolean; for_students: boolean };

export function flagsOf(audiences: readonly AudienceName[]): AudienceFlags {
  return {
    for_employees: audiences.includes("EMPLOYEES"),
    for_interns: audiences.includes("INTERNS"),
    for_students: audiences.includes("STUDENTS"),
  };
}

export function audiencesOf(flags: AudienceFlags): AudienceName[] {
  return [
    ...(flags.for_employees ? (["EMPLOYEES"] as const) : []),
    ...(flags.for_interns ? (["INTERNS"] as const) : []),
    ...(flags.for_students ? (["STUDENTS"] as const) : []),
  ];
}

// What is wrong with a choice of audience, if anything. Students are never mixed with the others, because their unit
// comes from a grade and they have no position or level.
export function audienceProblem(audiences: readonly AudienceName[]): string | null {
  if (audiences.length === 0) return "Pick who the group is for";
  if (audiences.includes("STUDENTS") && audiences.length > 1) return "A group of students cannot include employees or interns";
  return null;
}

export const staffOnly = (flags: AudienceFlags) => !flags.for_students;
