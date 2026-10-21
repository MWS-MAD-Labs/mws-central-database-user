import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/cn.js";
import { academicYearsApi, classesApi, gradesApi } from "../../academic/api/academicApi.js";
import { TableAcademic } from "../components/academic/pages/TableAcademic.jsx";
import { TableEnroll } from "../components/enrollments/pages/TableEnroll.jsx";
import { TableGrades } from "../components/grades/pages/TableGrades.jsx";
import { TableStudents } from "../components/students/pages/TableStudents.jsx";
import { WorkspaceTabs } from "../components/WorkspaceTabs.jsx";
import { WorkspaceToolbar } from "../components/WorkspaceToolbar.jsx";
import { defaultAcademicYearId } from "../utils/academicYear.js";
import { defaultWorkspaceTab } from "../utils/workspaceTabs.js";

const emptyContext = {
  academicYearId: "",
  gradeId: "",
  classId: "",
  search: "",
};

// Grades and academic years are small lists. Classes are loaded for the chosen year only.
async function loadWorkspaceOptions() {
  const [grades, academicYears] = await Promise.all([
    gradesApi.list({ page: 1, size: 100, sort_by: "level", sort_order: "asc" }),
    academicYearsApi.list({ page: 1, size: 100, sort_by: "start_date", sort_order: "desc" }),
  ]);
  return { grades: grades.data || [], academicYears: academicYears.data || [] };
}

export function WorkspaceTable() {
  const [activeTab, setActiveTab] = useState(defaultWorkspaceTab);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [context, setContext] = useState(emptyContext);

  const optionsQuery = useQuery({
    queryKey: ["workspace", "options"],
    queryFn: loadWorkspaceOptions,
    staleTime: 5 * 60 * 1000,
  });
  const academicYears = optionsQuery.data?.academicYears;
  const defaultYearId = useMemo(() => defaultAcademicYearId(academicYears || []), [academicYears]);
  // There is always a year: the one picked, or the default until one is picked.
  const academicYearId = context.academicYearId || defaultYearId;

  const classesQuery = useQuery({
    queryKey: ["workspace", "classes", academicYearId],
    queryFn: () =>
      classesApi.list({
        page: 1,
        size: 100,
        academic_year_id: academicYearId,
        sort_by: "grade_level",
        sort_order: "asc",
      }),
    enabled: Boolean(academicYearId),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!isFullscreen) return;

    function handleKeyDown(event) {
      if (event.key === "Escape") setIsFullscreen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const patchContext = useCallback((patch) => {
    // Another year has other classes, so a class picked before no longer applies.
    setContext((current) => ({
      ...current,
      ...(patch.academicYearId !== undefined ? { classId: "" } : {}),
      ...patch,
    }));
  }, []);

  const resetContext = useCallback(() => setContext(emptyContext), []);

  const options = useMemo(
    () => ({
      grades: optionsQuery.data?.grades || [],
      academicYears: academicYears || [],
      classes: classesQuery.data?.data || [],
    }),
    [optionsQuery.data?.grades, academicYears, classesQuery.data?.data],
  );

  const effectiveContext = useMemo(
    () => ({ ...context, academicYearId }),
    [context, academicYearId],
  );

  const academicYearsById = useMemo(
    () =>
      Object.fromEntries(
        options.academicYears.map((year) => [year.id, year.name]),
      ),
    [options.academicYears],
  );

  return (
    <div
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-50 h-screen w-screen bg-white"
          : "min-w-0",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col overflow-hidden border border-(--mws-line) bg-white",
          isFullscreen
            ? "h-screen w-screen rounded-none border-0 shadow-none"
            : "h-[calc(100vh-16rem)] min-h-[520px] rounded-2xl shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]",
        )}
      >
        <WorkspaceToolbar
          context={effectiveContext}
          defaultAcademicYearId={defaultYearId}
          onContextChange={patchContext}
          onReset={resetContext}
          options={options}
          isLoadingOptions={optionsQuery.isLoading}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen((current) => !current)}
        />

        <WorkspaceTabs activeTab={activeTab} onChange={setActiveTab} />

        <div className="min-h-0 min-w-0 flex-1">
          {activeTab === "students" ? (
            <TableStudents
              context={effectiveContext}
              academicYearsById={academicYearsById}
            />
          ) : null}

          {activeTab === "enrollments" ? <TableEnroll /> : null}
          {activeTab === "academic" ? <TableAcademic /> : null}
          {activeTab === "grades" ? <TableGrades /> : null}
        </div>
      </div>
    </div>
  );
}
