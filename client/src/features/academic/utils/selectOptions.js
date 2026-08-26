import { formatStatus, statusTone } from "../../../lib/format.js";

export function academicYearSelectOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    // Color the label instead of a separate badge - a live/upcoming year
    // stands out, a past (COMPLETED) one stays neutral rather than
    // sharing ACTIVE's green.
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}

export function gradeSelectOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ""}`,
  }));
}

export function employeeSelectOptions(employees) {
  return employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.employment.job_level,
    searchText: `${employee.identity.full_name} ${employee.employment.job_level}`,
  }));
}

export function specialEducationTeacherOptions(employees) {
  return employees.map((employee) => {
    const count = employee.active_student_count || 0;
    return {
      value: employee.id,
      label: employee.identity.full_name,
      description: employee.identity.email,
      badge: `${count} student${count === 1 ? "" : "s"}`,
      tone: count > 0 ? "amber" : "green",
      searchText: employee.identity.full_name,
    };
  });
}

export function studentSelectOptions(students) {
  return students.map((student) => ({
    value: student.id,
    label: student.identity.full_name,
    description: [
      student.academic.nis ? `NIS ${student.academic.nis}` : null,
      student.academic.current_grade
        ? `Grade ${student.academic.current_grade}`
        : null,
    ]
      .filter(Boolean)
      .join(" / "),
    badge: formatStatus(student.status),
    tone: statusTone(student.status),
    searchText: `${student.identity.full_name} ${student.academic.nis || ""} ${student.academic.current_grade || ""} ${student.status}`,
  }));
}

export function dedupeStudents(students) {
  const byId = new Map();
  students.forEach((student) => {
    byId.set(student.id, student);
  });
  return Array.from(byId.values()).sort((left, right) =>
    left.identity.full_name.localeCompare(right.identity.full_name),
  );
}

export function classSelectOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass);
    return {
      value: klass.id,
      label: klass.name,
      description: [
        klass.grade?.name,
        klass.academic_year?.name,
        capacity.description,
      ]
        .filter(Boolean)
        .join(" / "),
      badge: capacity.badge,
      tone: capacity.tone,
      searchText: `${klass.name} ${klass.grade?.name || ""} ${klass.academic_year?.name || ""} ${capacity.description}`,
    };
  });
}

export function getClassCapacityLabel(klass) {
  if (klass.capacity === null || klass.capacity === undefined) {
    return { description: "No capacity limit", badge: null, tone: "neutral" };
  }

  const activeCount = klass.active_enrollment_count ?? 0;
  const remaining = Math.max(klass.capacity - activeCount, 0);
  if (remaining === 0) {
    return {
      description: `${activeCount}/${klass.capacity} students`,
      badge: "Full",
      tone: "red",
    };
  }

  return {
    description: `${activeCount}/${klass.capacity} students, ${remaining} seats left`,
    badge: `${remaining} seats`,
    tone: remaining <= 3 ? "amber" : "green",
  };
}
