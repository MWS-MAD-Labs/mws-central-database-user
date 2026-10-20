import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { DateField, NumberInput, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import {
  CHILDREN_MODES,
  CHILD_RELATIONS,
  MAX_CHILDREN,
  countsAreStale,
  describeChildren,
  emptyChild,
  findProblemsFor,
  summarizeChildrenValue,
} from "../utils/childrenRules.js";

const MODE_HINTS = {
  NONE: "No children are recorded for this employee.",
  BIRTH_DATES: "Birth dates are kept so the numbers stay right as the children grow up.",
  COUNTS:
    "For a parent who prefers not to share birth dates. These numbers do not change by themselves, so they are reviewed after a year.",
};

const formatDay = (value) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// The children of an employee, recorded one of two ways: a birth date per child, or just three numbers for a parent
// who does not share birth dates. `value` holds both, `mode` says which one counts.
export function ChildrenField({ value, onChange, maritalStatus, parentBirthDate }) {
  const idPrefix = useId();
  const single = maritalStatus === "SINGLE";
  const problems = findProblemsFor(value, { maritalStatus, parentBirthDate });
  const summary = summarizeChildrenValue(value);
  const relationOptions = CHILD_RELATIONS.map((relation) => ({
    ...relation,
    disabled: single && relation.value !== "ADOPTED",
    description: single && relation.value !== "ADOPTED" ? "Not available while single" : undefined,
  }));

  const patch = (next) => onChange({ ...value, ...next });
  const newRow = () => emptyChild(single ? "ADOPTED" : "BIOLOGICAL");
  // The tab always has a row to fill in; a blank one is never sent.
  const rows = value.rows.length > 0 ? value.rows : [newRow()];
  const updateRow = (index, next) =>
    patch({ rows: rows.map((child, position) => (position === index ? { ...child, ...next } : child)) });
  const removeRow = (index) => {
    const left = rows.filter((_, position) => position !== index);
    patch({ rows: left.length > 0 ? left : [newRow()] });
  };
  const addRowAfter = (index) => patch({ rows: [...rows.slice(0, index + 1), newRow(), ...rows.slice(index + 1)] });
  const updateCount = (field, text) => patch({ counts: { ...value.counts, [field]: text }, confirmed: false });
  const stale = value.needs_review || countsAreStale(value.declared_at);

  return (
    <div className="space-y-4 rounded-xl border border-(--mws-line) bg-white p-4" data-testid="children-field">
      <Tabs
        label="How the children are recorded"
        tabs={CHILDREN_MODES}
        active={value.mode}
        onChange={(mode) => patch({ mode })}
      />
      <p className="text-xs text-(--mws-muted)">{MODE_HINTS[value.mode]}</p>

      {value.mode === "BIRTH_DATES" ? (
        <div className="space-y-3">
          <div className="hidden gap-3 text-xs font-semibold text-(--mws-muted) md:grid md:grid-cols-[1fr_1fr_5.5rem]">
            <span>Birth date (DD/MM/YYYY)</span>
            <span>Relation</span>
            <span />
          </div>
          {rows.map((child, index) => (
            <div key={index} className="grid items-start gap-3 md:grid-cols-[1fr_1fr_5.5rem]">
              <div className="space-y-1">
                <DateField
                  invalid={Boolean(problems.byRow[index])}
                  value={child.birth_date}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => updateRow(index, { birth_date: event.target.value })}
                />
                {problems.byRow[index] ? <p className="text-xs text-[#a43c41]">{problems.byRow[index]}</p> : null}
              </div>
              <SearchableSelect
                value={child.relation}
                onChange={(next) => updateRow(index, { relation: next })}
                options={relationOptions}
                placeholder="Select how they are related"
              />
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove child ${index + 1}`}
                  disabled={rows.length === 1 && !child.birth_date}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Add another child after child ${index + 1}`}
                  disabled={!child.birth_date || rows.length >= MAX_CHILDREN}
                  onClick={() => addRowAfter(index)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {value.mode === "COUNTS" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["under_23", "Under 23"],
              ["age_23_plus", "23 or older"],
              ["adopted", "Of these, adopted"],
            ].map(([field, label]) => (
              <div key={field} className="space-y-1">
                <label htmlFor={`${idPrefix}-${field}`} className="text-xs font-semibold text-(--mws-muted)">
                  {label}
                </label>
                <NumberInput
                  id={`${idPrefix}-${field}`}
                  value={value.counts[field]}
                  max={MAX_CHILDREN}
                  invalid={Boolean(problems.list)}
                  placeholder="0"
                  onChange={(text) => updateCount(field, text)}
                />
              </div>
            ))}
          </div>
          {value.declared_at ? (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={stale ? "font-semibold text-[#a43c41]" : "text-(--mws-muted)"}>
                {stale ? "Needs review. " : ""}Last confirmed {formatDay(value.declared_at)}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={value.confirmed}
                onClick={() => patch({ confirmed: true })}
              >
                {value.confirmed ? "Will be confirmed when saved" : "Confirm still correct"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {problems.list ? <p className="text-xs text-[#a43c41]">{problems.list}</p> : null}

      {value.mode !== "NONE" && summary.total > 0 ? (
        <p className="text-sm text-(--mws-muted)" aria-live="polite">
          {describeChildren(summary)}
        </p>
      ) : null}
    </div>
  );
}
