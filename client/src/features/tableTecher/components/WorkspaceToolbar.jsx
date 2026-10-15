import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  DebouncedSearchInput,
  FilterSelect,
} from "../../../components/ui/FormControls.jsx";
import { formatStatus } from "../../../lib/format.js";

export function WorkspaceToolbar({
  context,
  defaultAcademicYearId,
  onContextChange,
  onReset,
  options,
  isLoadingOptions,
  isFullscreen,
  onToggleFullscreen,
}) {
  const isFilterActive = Boolean(
    (context.academicYearId && context.academicYearId !== defaultAcademicYearId) ||
      context.gradeId ||
      context.classId ||
      context.search,
  );

  return (
    <div className="shrink-0 border-b border-(--mws-line) p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-(--mws-muted)">
          Students are listed for the academic year you pick. 
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <FilterSelect
            label="Academic Year"
            value={context.academicYearId}
            onChange={(value) => onContextChange({ academicYearId: value })}
            options={academicYearOptions(options.academicYears)}
          />

          <FilterSelect
            label="Grade"
            value={context.gradeId}
            onChange={(value) => onContextChange({ gradeId: value })}
            options={[
              { value: "", label: "All Grades" },
              ...gradeOptions(options.grades),
            ]}
          />

          <FilterSelect
            label="Class"
            value={context.classId}
            onChange={(value) => onContextChange({ classId: value })}
            options={[
              { value: "", label: "All Classes" },
              ...classOptions(options.classes),
            ]}
          />

          {isFilterActive ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReset}
            >
              <RotateCcw size={15} />
              Reset
            </Button>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1.5">
          <span className="block font-display text-xs font-bold text-(--mws-muted)">
            Search
          </span>
          <DebouncedSearchInput
            value={context.search}
            placeholder="Search Name, Email, NIS, Or NISN"
            onChange={(search) => onContextChange({ search })}
          />
        </div>
      </div>

      {isLoadingOptions ? (
        <p className="mt-2 text-xs text-(--mws-muted)">
          Loading workspace context...
        </p>
      ) : null}
    </div>
  );
}

function gradeOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ""}`,
  }));
}

function classOptions(classes) {
  return classes.map((schoolClass) => ({
    value: schoolClass.id,
    label: schoolClass.name,
    description: [schoolClass.grade?.name, schoolClass.academic_year?.name]
      .filter(Boolean)
      .join(" / "),
    searchText: `${schoolClass.name} ${schoolClass.grade?.name || ""} ${schoolClass.academic_year?.name || ""}`,
  }));
}

function academicYearOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}
