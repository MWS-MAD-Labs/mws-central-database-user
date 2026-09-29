import {
  ClassStatus,
  EmployeeStatus,
  Gender,
  PersonType,
  type Prisma,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { DashboardUser } from "../type/hono-context";
import {
  canViewAcademicData,
  canViewEmployeeData,
  canViewStudentData,
  resolveAcademicUnitScope,
  resolveEmployeeUnitScope,
  resolveStudentUnitScope,
} from "../utils/admin-permissions";

type GenderCounts = Record<Gender, number>;
type BucketCounts = Record<string, number>;

type ClassByGrade = {
  grade_id: string;
  grade_name: string;
  grade_level: number;
  total: number;
};

type BirthdayEmployee = {
  id: string;
  full_name: string;
  nick_name: string;
  birthday: string;
  day: number;
  unit: string;
  job_position: string;
};

export type DashboardSummaryResponse = {
  totals: {
    // Employees + interns combined - the workforce headline number.
    employees: number;
    // Breakdown of how many of `totals.employees` are interns.
    interns: number;
    students: number;
    classes: number;
  };
  employees: {
    by_gender: GenderCounts;
    by_age_bucket: BucketCounts;
    by_status: Record<EmployeeStatus, number>;
    birthdays_this_month: BirthdayEmployee[];
  };
  students: {
    by_gender: GenderCounts;
    by_age_bucket: BucketCounts;
  };
  classes: {
    active: number;
    by_grade: ClassByGrade[];
  };
};

const EMPLOYEE_AGE_BUCKETS = ["<25", "25-34", "35-44", "45-54", "55+"];
const STUDENT_AGE_BUCKETS = ["0-5", "6-12", "13-18", "19+"];
const CURRENT_EMPLOYEE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.ON_LEAVE,
];

const baseEmployeePersonWhere = {
  person_type: PersonType.EMPLOYEE,
  deleted_at: null,
  employee: { deleted_at: null },
} satisfies Prisma.PersonWhereInput;

const baseStudentPersonWhere = {
  person_type: PersonType.STUDENT,
  deleted_at: null,
  student: { deleted_at: null },
} satisfies Prisma.PersonWhereInput;

export class DashboardService {
  static async summary(
    user: DashboardUser,
    now: Date = new Date(),
  ): Promise<DashboardSummaryResponse> {
    const admin = user.type === "admin" ? user.admin : null;
    // An employee (non-admin) login is restricted by their own teaching
    // flag - staff sees employee-side metrics only, teachers see both.
    const isTeacher =
      user.type === "employee" &&
      Boolean(user.employee.employee?.job_level.is_teaching_role);
    const includeEmployees = !admin || canViewEmployeeData(admin);
    const includeStudents = admin ? canViewStudentData(admin) : isTeacher;
    const includeClasses = admin ? canViewAcademicData(admin) : isTeacher;
    const employeeUnitScope = admin
      ? resolveEmployeeUnitScope(admin)
      : undefined;
    const studentUnitScope = admin
      ? resolveStudentUnitScope(admin)
      : undefined;
    const academicUnitScope = admin
      ? resolveAcademicUnitScope(admin)
      : undefined;
    const [
      employeePeople,
      internPeople,
      studentPeople,
      employeeStatusGroups,
      activeClasses,
    ] = await Promise.all([
      includeEmployees ? prismaClient.person.findMany({
        where: {
          ...baseEmployeePersonWhere,
          ...(employeeUnitScope
            ? {
                employee: {
                  deleted_at: null,
                  unit_id: { in: employeeUnitScope },
                },
              }
            : {}),
        },
        select: {
          id: true,
          full_name: true,
          nick_name: true,
          gender: true,
          birth_date: true,
          employee: {
            select: {
              id: true,
              status: true,
              unit: { select: { name: true } },
              job_position: { select: { name: true } },
            },
          },
        },
      }) : Promise.resolve([]),
      // Intern is a separate model from Employee/Person - counted into the
      // same workforce metrics (gender/age dist, total) with its own
      // breakdown count so the headline number doesn't silently conflate
      // the two without a way to tell them apart.
      includeEmployees ? prismaClient.intern.findMany({
        where: {
          deleted_at: null,
          ...(employeeUnitScope
            ? { unit_id: { in: employeeUnitScope } }
            : {}),
        },
        select: {
          gender: true,
          birth_date: true,
        },
      }) : Promise.resolve([]),
      includeStudents ? prismaClient.person.findMany({
        where: {
          ...baseStudentPersonWhere,
          ...(studentUnitScope
            ? {
                student: {
                  deleted_at: null,
                  current_grade: { unit_id: { in: studentUnitScope } },
                },
              }
            : {}),
        },
        select: {
          gender: true,
          birth_date: true,
        },
      }) : Promise.resolve([]),
      includeEmployees ? prismaClient.employee.groupBy({
        by: ["status"],
        where: {
          deleted_at: null,
          person: { deleted_at: null },
          ...(employeeUnitScope
            ? { unit_id: { in: employeeUnitScope } }
            : {}),
        },
        _count: { _all: true },
      }) : Promise.resolve([]),
      includeClasses ? prismaClient.class.findMany({
        where: {
          status: ClassStatus.ACTIVE,
          ...(academicUnitScope
            ? { grade: { unit_id: { in: academicUnitScope } } }
            : {}),
        },
        select: {
          grade: { select: { id: true, name: true, level: true } },
          // Include every grade taught by mixed-age classes.
          additional_grades: {
            select: {
              grade: { select: { id: true, name: true, level: true } },
            },
          },
        },
      }) : Promise.resolve([]),
    ]);

    const activeClassByGrade = aggregateClassesByGrade(activeClasses);
    const internsWithBirthDate = internPeople
      .filter((intern) => intern.birth_date !== null)
      .map((intern) => ({
        gender: intern.gender,
        birth_date: intern.birth_date as Date,
      }));

    return {
      totals: {
        employees: employeePeople.length + internPeople.length,
        interns: internPeople.length,
        students: studentPeople.length,
        classes: activeClasses.length,
      },
      employees: {
        by_gender: countByGender([...employeePeople, ...internPeople]),
        // Intern.birth_date is optional (unlike Person.birth_date) - skip
        // interns with none set rather than inventing an age bucket.
        by_age_bucket: countEmployeeAgeBuckets(
          [...employeePeople, ...internsWithBirthDate],
          now,
        ),
        by_status: countEmployeeStatuses(employeeStatusGroups),
        birthdays_this_month: getEmployeeBirthdaysThisMonth(
          employeePeople,
          now,
        ),
      },
      students: {
        by_gender: countByGender(studentPeople),
        by_age_bucket: countStudentAgeBuckets(studentPeople, now),
      },
      classes: {
        active: activeClasses.length,
        by_grade: activeClassByGrade,
      },
    };
  }
}

function countByGender(items: Array<{ gender: Gender }>): GenderCounts {
  const counts = createGenderCounts();
  for (const item of items) {
    counts[item.gender] += 1;
  }
  return counts;
}

function countEmployeeAgeBuckets(
  items: Array<{ birth_date: Date }>,
  now: Date,
): BucketCounts {
  const counts = createBucketCounts(EMPLOYEE_AGE_BUCKETS);
  for (const item of items) {
    const age = calculateAge(item.birth_date, now);
    if (age < 25) counts["<25"] += 1;
    else if (age <= 34) counts["25-34"] += 1;
    else if (age <= 44) counts["35-44"] += 1;
    else if (age <= 54) counts["45-54"] += 1;
    else counts["55+"] += 1;
  }
  return counts;
}

function countStudentAgeBuckets(
  items: Array<{ birth_date: Date }>,
  now: Date,
): BucketCounts {
  const counts = createBucketCounts(STUDENT_AGE_BUCKETS);
  for (const item of items) {
    const age = calculateAge(item.birth_date, now);
    if (age <= 5) counts["0-5"] += 1;
    else if (age <= 12) counts["6-12"] += 1;
    else if (age <= 18) counts["13-18"] += 1;
    else counts["19+"] += 1;
  }
  return counts;
}

function countEmployeeStatuses(
  groups: Array<{ status: EmployeeStatus; _count: { _all: number } }>,
): Record<EmployeeStatus, number> {
  const counts = Object.fromEntries(
    Object.values(EmployeeStatus).map((status) => [status, 0]),
  ) as Record<EmployeeStatus, number>;

  for (const group of groups) {
    counts[group.status] = group._count._all;
  }

  return counts;
}

function getEmployeeBirthdaysThisMonth(
  items: Array<{
    id: string;
    full_name: string;
    nick_name: string;
    birth_date: Date;
    employee: {
      id: string;
      status: EmployeeStatus;
      unit: { name: string };
      job_position: { name: string };
    } | null;
  }>,
  now: Date,
): BirthdayEmployee[] {
  const month = now.getMonth();

  return items
    .filter((item) => {
      return (
        item.employee &&
        CURRENT_EMPLOYEE_STATUSES.includes(item.employee.status) &&
        item.birth_date.getMonth() === month
      );
    })
    .map((item) => ({
      id: item.employee!.id,
      full_name: item.full_name,
      nick_name: item.nick_name,
      birthday: formatMonthDay(item.birth_date),
      day: item.birth_date.getDate(),
      unit: item.employee!.unit.name,
      job_position: item.employee!.job_position.name,
    }))
    .sort((a, b) => a.day - b.day || a.full_name.localeCompare(b.full_name));
}

type GradeRef = { id: string; name: string; level: number };

// Count mixed-age classes once for each grade taught.
function aggregateClassesByGrade(
  classes: Array<{ grade: GradeRef; additional_grades: { grade: GradeRef }[] }>,
): ClassByGrade[] {
  const byGrade = new Map<string, ClassByGrade>();

  for (const item of classes) {
    const grades = [item.grade, ...item.additional_grades.map((entry) => entry.grade)];
    for (const grade of grades) {
      const existing = byGrade.get(grade.id);
      if (existing) {
        existing.total += 1;
        continue;
      }

      byGrade.set(grade.id, {
        grade_id: grade.id,
        grade_name: grade.name,
        grade_level: grade.level,
        total: 1,
      });
    }
  }

  return Array.from(byGrade.values()).sort(
    (a, b) =>
      a.grade_level - b.grade_level ||
      a.grade_name.localeCompare(b.grade_name),
  );
}

function createGenderCounts(): GenderCounts {
  return {
    [Gender.MALE]: 0,
    [Gender.FEMALE]: 0,
  };
}

function createBucketCounts(labels: string[]): BucketCounts {
  return Object.fromEntries(labels.map((label) => [label, 0]));
}

function calculateAge(birthDate: Date, now: Date): number {
  let age = now.getFullYear() - birthDate.getFullYear();
  const birthdayThisYear = new Date(
    now.getFullYear(),
    birthDate.getMonth(),
    birthDate.getDate(),
  );

  if (birthdayThisYear > now) {
    age -= 1;
  }

  return age;
}

function formatMonthDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}
