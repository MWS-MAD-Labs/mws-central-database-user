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

export const emptyChild = (relation = "BIOLOGICAL") => ({ birth_date: "", relation });

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
        byRow[index] =
          `A biological child must be at least ${MIN_PARENT_AGE_GAP_YEARS} years younger than the employee.`;
      }
      return;
    }
    if (utcDay(child.birth_date) <= utcDay(parentBirthDate)) {
      byRow[index] = "A child must be younger than the employee.";
    }
  });

  return { byRow, list, hasProblems: Boolean(list) || Object.keys(byRow).length > 0 };
}

// The second way to record children, for a parent who does not share birth dates: three typed numbers. Same limits as
// the server (employee-children-rules.ts).
export const COUNTS_REVIEW_AFTER_MONTHS = 12;

export const CHILDREN_MODES = [
  { value: "NONE", label: "No children recorded" },
  { value: "BIRTH_DATES", label: "With birth dates" },
  { value: "COUNTS", label: "Numbers only" },
];

// The form keeps both ways side by side, so switching between them does not lose what was typed.
export const emptyChildrenValue = () => ({
  mode: "NONE",
  rows: [],
  counts: { under_23: "", age_23_plus: "", adopted: "" },
  declared_at: null,
  needs_review: false,
  confirmed: false,
});

export function childrenValueFromResponse(children) {
  const value = emptyChildrenValue();
  if (!children) return value;
  const counts = children.counts;
  return {
    ...value,
    mode: children.mode || "NONE",
    rows: (children.items || []).map(({ birth_date, relation }) => ({ birth_date, relation })),
    counts: counts
      ? { under_23: String(counts.under_23), age_23_plus: String(counts.age_23_plus), adopted: String(counts.adopted) }
      : value.counts,
    declared_at: children.declared_at || null,
    needs_review: Boolean(children.needs_review),
  };
}

const toCount = (text) => (text === "" || text == null ? 0 : Number(text));

export function countsFromText(counts) {
  return {
    under_23: toCount(counts.under_23),
    age_23_plus: toCount(counts.age_23_plus),
    adopted: toCount(counts.adopted),
  };
}

export function summarizeCounts(counts) {
  const numbers = countsFromText(counts);
  return {
    total: numbers.under_23 + numbers.age_23_plus,
    under_23: numbers.under_23,
    age_23_plus: numbers.age_23_plus,
  };
}

// The numbers to show for whichever way is picked.
export function summarizeChildrenValue(value) {
  if (value.mode === "COUNTS") return summarizeCounts(value.counts);
  if (value.mode === "BIRTH_DATES") return summarizeChildren(value.rows);
  return { total: 0, under_23: 0, age_23_plus: 0 };
}

// What is wrong with the typed numbers. A child who is not adopted counts as biological, like on the server.
export function findCountsProblems({ maritalStatus, parentBirthDate, counts, today = todayText() }) {
  const { under_23, age_23_plus, adopted } = countsFromText(counts);
  const total = under_23 + age_23_plus;
  if (total > MAX_CHILDREN) return `An employee can have at most ${MAX_CHILDREN} children on record.`;
  if (adopted > total) return "Adopted children cannot be more than the children in total.";
  if (maritalStatus === "SINGLE" && adopted < total) {
    return "An employee who is single can only have adopted children on record.";
  }
  const minParentAge = ALLOWANCE_AGE_LIMIT + MIN_PARENT_AGE_GAP_YEARS;
  if (age_23_plus - adopted > 0 && parentBirthDate && ageOn(parentBirthDate, today) < minParentAge) {
    return `Children aged ${ALLOWANCE_AGE_LIMIT} or over who are not adopted need a parent of at least ${minParentAge}.`;
  }
  return null;
}

// One answer for the form, whichever way the children are recorded.
export function findProblemsFor(value, context) {
  if (value.mode === "COUNTS") {
    const list = findCountsProblems({ ...context, counts: value.counts });
    return { byRow: {}, list, hasProblems: Boolean(list) };
  }
  if (value.mode === "BIRTH_DATES") return findChildrenProblems({ ...context, children: value.rows });
  return { byRow: {}, list: null, hasProblems: false };
}

// True when the typed numbers were last confirmed more than a year ago.
export function countsAreStale(declaredAt, today = new Date()) {
  if (!declaredAt) return false;
  const limit = new Date(declaredAt);
  limit.setUTCMonth(limit.getUTCMonth() + COUNTS_REVIEW_AFTER_MONTHS);
  return today > limit;
}

// The part of the form value the server cares about, to tell whether anything changed.
const comparable = (value) =>
  JSON.stringify(
    value.mode === "COUNTS"
      ? [value.mode, countsFromText(value.counts)]
      : value.mode === "BIRTH_DATES"
        ? [value.mode, value.rows]
        : [value.mode],
  );

// What to put in the request. Birth dates go as `children`, numbers as `children_counts`, and sending one clears
// the other on the server. Nothing is sent when nothing changed, so an unrelated edit never touches the children.
export function childrenPayload(value, { isCreate = false, initial = emptyChildrenValue() } = {}) {
  const changed = comparable(value) !== comparable(initial) || value.confirmed;
  if (value.mode === "COUNTS") {
    const counts = countsFromText(value.counts);
    const hasAny = counts.under_23 + counts.age_23_plus > 0;
    if (isCreate ? !hasAny : !changed) return {};
    return { children_counts: counts };
  }
  if (value.mode === "BIRTH_DATES") {
    const rows = value.rows
      .filter((child) => child.birth_date)
      .map(({ birth_date, relation }) => ({ birth_date, relation }));
    if (isCreate ? rows.length === 0 : !changed) return {};
    return { children: rows };
  }
  return !isCreate && changed ? { children: [], children_counts: null } : {};
}
