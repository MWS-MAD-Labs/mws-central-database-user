export function scopeName(scope) {
  return typeof scope === "string" ? scope : scope.name;
}

// Plain-language names for the scope catalog, so the UI reads well for people
// who do not know the technical scope strings. Unknown (new) scopes fall back
// to a label derived from the name and the description stored with the scope.
const SCOPE_INFO = {
  "employees:read": {
    group: "Employees",
    title: "View employee profiles",
    description: "Names, job positions, units and employment details.",
  },
  "students:read": {
    group: "Students",
    title: "View student profiles",
    description: "Names, grade, class and basic student details.",
  },
  "students:academic_history:read": {
    group: "Students",
    title: "View student class and grade history",
    description: "Which classes and grades a student was in over time.",
  },
  "students:support_contacts:read": {
    group: "Students",
    title: "View a student's class teachers",
    description: "The homeroom and subject teachers of a student's current class.",
  },
  "students:health:read": {
    group: "Students",
    title: "View student health records",
    description: "Health information and special needs.",
  },
  "students:consent:read": {
    group: "Students",
    title: "View student consent documents",
    description: "Consent forms and their attachments.",
  },
  "students:roster_export:read": {
    group: "Students",
    title: "Download the full student roster",
    description:
      "One flat list of every student, including health, parent contact and consent fields.",
  },
  "classes:read": {
    group: "Classes and Teachers",
    title: "View all classes",
    description: "Every active class, even those without a teacher assigned.",
  },
  "class_teacher_assignments:read": {
    group: "Classes and Teachers",
    title: "View which classes a teacher is assigned to",
    description: "Homeroom and subject class assignments of a teacher.",
  },
  "student_support_assignments:read": {
    group: "Classes and Teachers",
    title: "View which students a support teacher looks after",
    description: "Students assigned to a special education or support teacher.",
  },
  "application_entitlements:read": {
    group: "Application Access",
    title: "View who may use an application",
    description: "Which people currently have access to each MWS application.",
  },
  "application_permissions:write": {
    group: "Application Access",
    title: "Publish an application's permissions",
    description:
      "Lets an application send the permissions its code understands, so roles can only use those.",
  },
};

export const SCOPE_GROUP_ORDER = [
  "Employees",
  "Students",
  "Classes and Teachers",
  "Application Access",
  "Other",
];

function humanize(name) {
  const parts = name.split(":");
  const action = parts.at(-1) === "read" ? "View" : parts.at(-1);
  const subject = parts.slice(0, -1).join(" ").replaceAll("_", " ");
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${subject}`.trim();
}

export function describeScope(scope) {
  const name = scopeName(scope);
  const known = SCOPE_INFO[name];
  return {
    name,
    group: known?.group || "Other",
    title: known?.title || humanize(name),
    description:
      known?.description || (typeof scope === "object" ? scope.description : "") || "",
    sensitive: typeof scope === "object" && Boolean(scope.is_sensitive),
  };
}

export function groupScopes(scopes) {
  const groups = new Map();
  for (const scope of scopes) {
    const info = describeScope(scope);
    if (!groups.has(info.group)) groups.set(info.group, []);
    groups.get(info.group).push(info);
  }
  return SCOPE_GROUP_ORDER.filter((group) => groups.has(group)).map((group) => ({
    group,
    items: groups.get(group).sort((a, b) => a.title.localeCompare(b.title)),
  }));
}

export const PURPOSE_LABELS = {
  backend: "Backend Service",
  "roster-sync": "Roster Sync",
  "report-export": "Report Export",
  ci: "CI / Automation",
  other: "Other",
};
