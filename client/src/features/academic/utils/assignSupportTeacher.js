import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";

// Gives the chosen SE teacher to each student that was just enrolled. Each call is checked by the server against the
// caseload limit, so some may be refused. They are counted and the first reason is kept, so the person is told.
export async function assignSupportTeacher(supportTarget, studentIds) {
  const settled = await Promise.allSettled(
    studentIds.map((id) =>
      studentSensitiveApi.createSupportAssignment(id, {
        ...supportTarget,
        role: "SPECIAL_ED",
      }),
    ),
  );
  const refused = settled.filter((item) => item.status === "rejected");
  const reason = refused[0]?.reason;
  return {
    failed: refused.length,
    reason: reason?.message || (typeof reason === "string" ? reason : null),
  };
}

export function supportFailureMessage(failed, reason) {
  return `${failed} student${failed === 1 ? " was" : "s were"} enrolled but ${failed === 1 ? "has" : "have"} no SE teacher yet${reason ? `: ${reason}` : "."}`;
}
