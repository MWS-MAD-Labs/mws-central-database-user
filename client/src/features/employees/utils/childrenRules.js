// The same rules the server enforces for an employee's children (server/src/utils/employee-children-rules.ts), so the
// form can say what is wrong while it is typed. The server is still the one that decides.
export const MIN_PARENT_AGE_GAP_YEARS = 18;
export const MAX_CHILDREN = 20;
export const ALLOWANCE_AGE_LIMIT = 23;

export const CHILD_RELATIONS = [
  { value: "BIOLOGICAL", label: "Biological" },
  { value: "ADOPTED", label: "Adopted" },
  { value: "STEP", label: "Step" },
];

export const emptyChild = () => ({ birth_date: "", relation: "BIOLOGICAL" });

const utcDay = (value) => {
  const [year, month, day] = String(value).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

const todayText = () => new Date().toISOString().slice(0, 10);

// Whole years from `birth` to `on`, both as YYYY-MM-DD. The birthday itself counts.
export function ageOn(birth, on) {
  const from = new Date(utcDay(birth));
  const to = new Date(utcDay(on));
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const beforeBirthday =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
}

const addYears = (value, years) => {
  const date = new Date(utcDay(value));
  return Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate());
};

export function summarizeChildren(children, today = todayText()) {
  const dated = children.filter((child) => child.birth_date);
  const under = dated.filter((child) => ageOn(child.birth_date, today) < ALLOWANCE_AGE_LIMIT).length;
  return { total: dated.length, under_23: under, age_23_plus: dated.length - under };
}

// "3 children: 2 under 23, 1 aged 23 or over"
export function describeChildren(summary) {
  if (!summary || summary.total === 0) return "No children";
  const noun = summary.total === 1 ? "child" : "children";
  return `${summary.total} ${noun}: ${summary.under_23} under 23, ${summary.age_23_plus} aged 23 or over`;
}

// What is wrong with the rows, by row index, plus a problem about the list as a whole. Rows without a date yet are
// skipped: they are unfinished, not wrong.
export function findChildrenProblems({ maritalStatus, parentBirthDate, children, today = todayText() }) {
  const byRow = {};
  let list = null;
  if (children.length > MAX_CHILDREN) list = `An employee can have at most ${MAX_CHILDREN} children on record.`;

  children.forEach((child, index) => {
    if (!child.birth_date) return;
    if (utcDay(child.birth_date) > utcDay(today)) {
      byRow[index] = "A child cannot be born in the future.";
      return;
    }
    if (maritalStatus === "SINGLE" && child.relation !== "ADOPTED") {
      byRow[index] = "An employee who is single can only have an adopted child on record.";
      return;
    }
    if (!parentBirthDate) return;
    if (child.relation === "BIOLOGICAL") {
      if (utcDay(child.birth_date) < addYears(parentBirthDate, MIN_PARENT_AGE_GAP_YEARS)) {
        byRow[index] = `A biological child must be at least ${MIN_PARENT_AGE_GAP_YEARS} years younger than the employee.`;
      }
      return;
    }
    if (utcDay(child.birth_date) <= utcDay(parentBirthDate)) {
      byRow[index] = "A child must be younger than the employee.";
    }
  });

  return { byRow, list, hasProblems: Boolean(list) || Object.keys(byRow).length > 0 };
}
