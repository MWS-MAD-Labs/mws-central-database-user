const memberOf = (teacher) => teacher.workforce_member || teacher.employee;

export function teacherName(teacher) {
  return memberOf(teacher)?.full_name || "Unknown teacher";
}

function roles(klass) {
  return [
    { title: "Homeroom", teachers: klass.homeroom_teachers || [], name: teacherName },
    { title: "Supporting", teachers: klass.supporting_homeroom_teachers || [], name: teacherName },
    {
      title: "Subject",
      teachers: klass.subject_teachers || [],
      name: (teacher) => `${teacherName(teacher)}${teacher.subject ? ` (${teacher.subject})` : ""}`,
    },
  ];
}

export function classTeacherCount(klass) {
  return roles(klass).reduce((total, role) => total + role.teachers.length, 0);
}

// "2 Homeroom · 1 Subject": the roles that have someone, as one line.
export function classTeacherSummary(klass) {
  return roles(klass)
    .filter((role) => role.teachers.length > 0)
    .map((role) => `${role.teachers.length} ${role.title}`)
    .join(" · ");
}

// The names behind the summary, grouped by role.
export function classTeacherGroups(klass) {
  return roles(klass)
    .filter((role) => role.teachers.length > 0)
    .map((role) => ({ title: role.title, items: role.teachers.map(role.name) }));
}

// The only teacher of a class, when there is exactly one.
export function onlyTeacher(klass) {
  const all = roles(klass).flatMap((role) => role.teachers);
  return all.length === 1 ? all[0] : null;
}

// The grade of a class and the extra grades of a mixed class.
export function classGradeNames(klass) {
  return [klass.grade, ...(klass.additional_grades || [])].filter(Boolean).map((grade) => grade.name);
}
