import type { Person } from "../generated/prisma/client";
import {
  toEmployeeLookupResponse,
  type EmployeeLookupResponse,
} from "./employee-api-model";
import {
  toStudentLookupResponse,
  type StudentLookupPerson,
  type StudentLookupResponse,
} from "./student-api-model";
import type { PersonWithEmployee } from "./employee-model";
import { toInternLookupResponse, type InternLookupResponse, type InternPerson } from "./intern-api-model";

export type PersonLookupRequest = {
  email: string;
};

export type PersonLookupPerson = Person & {
  employee: PersonWithEmployee["employee"];
  intern?: InternPerson["intern"];
  student: StudentLookupPerson["student"];
};

// Collapses mws-hub's old employee-then-student fallback (two sequential
// HTTP calls, one wasted on every student sign-in) into one Person query -
// see resolveCentralIdentity() in mws-hub's central-client.ts.
export type PersonLookupResponse =
  | ({ source: "employee" } & EmployeeLookupResponse)
  | ({ source: "intern" } & InternLookupResponse)
  | ({ source: "student" } & StudentLookupResponse);

export function toPersonLookupResponse(
  person: PersonLookupPerson,
): PersonLookupResponse {
  if (person.employee) {
    return {
      source: "employee",
      ...toEmployeeLookupResponse(person as PersonWithEmployee),
    };
  }

  if (person.intern) {
    return { source: "intern", ...toInternLookupResponse(person as InternPerson) };
  }

  return {
    source: "student",
    ...toStudentLookupResponse(person as StudentLookupPerson),
  };
}
