import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { DateField, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import {
  CHILD_RELATIONS,
  MAX_CHILDREN,
  describeChildren,
  emptyChild,
  findChildrenProblems,
  summarizeChildren,
} from "../utils/childrenRules.js";

// The children of an employee: one row per child with a birth date and how they are related. The numbers (how many,
// under 23, 23 or over) are worked out from the dates and are never typed.
export function ChildrenField({ value, onChange, maritalStatus, parentBirthDate }) {
  const problems = findChildrenProblems({ maritalStatus, parentBirthDate, children: value });
  const summary = summarizeChildren(value);

  function updateRow(index, patch) {
    onChange(value.map((child, position) => (position === index ? { ...child, ...patch } : child)));
  }

  return (
    <div className="space-y-3" data-testid="children-field">
      {value.map((child, index) => (
        <div key={index} className="grid items-start gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <DateField
              invalid={Boolean(problems.byRow[index])}
              value={child.birth_date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => updateRow(index, { birth_date: event.target.value })}
            />
            {problems.byRow[index] ? (
              <p className="text-xs text-[#a43c41]">{problems.byRow[index]}</p>
            ) : null}
          </div>
          <SearchableSelect
            value={child.relation}
            onChange={(next) => updateRow(index, { relation: next })}
            options={CHILD_RELATIONS}
            placeholder="Select how they are related"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove child ${index + 1}`}
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}

      {problems.list ? <p className="text-xs text-[#a43c41]">{problems.list}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={value.length >= MAX_CHILDREN}
          onClick={() => onChange([...value, emptyChild()])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add child
        </Button>
        <p className="text-sm text-(--mws-muted)" aria-live="polite">
          {describeChildren(summary)}
        </p>
      </div>
    </div>
  );
}
