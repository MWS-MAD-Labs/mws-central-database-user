import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/cn.js";
import { loadStudentFormOptions } from "../../students/api/studentFormOptions.js";
import { TableAcademic } from "../components/academic/pages/TableAcademic.jsx";
import { TableEnroll } from "../components/enrollments/pages/TableEnroll.jsx";
import { TableGrades } from "../components/grades/pages/TableGrades.jsx";
import { TableStudents } from "../components/students/pages/TableStudents.jsx";
import { WorkspaceTabs } from "../components/WorkspaceTabs.jsx";
import { WorkspaceToolbar } from "../components/WorkspaceToolbar.jsx";
import { defaultWorkspaceTab } from "../utils/workspaceTabs.js";

const emptyContext = {
  academicYearId: "",
  gradeId: "",
  classId: "",
  search: "",
};

// Orchestrator only: header, context, tabs, and which table is active.
// Domain data fetching stays inside each table component.
export function WorkspaceTable() {
  const [activeTab, setActiveTab] = useState(defaultWorkspaceTab);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [context, setContext] = useState(emptyContext);

  // Shared lookup lists for the context filters, not domain row data.
  const optionsQuery = useQuery({
    queryKey: ["workspace", "options"],
    queryFn: loadStudentFormOptions,
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
    setContext((current) => ({ ...current, ...patch }));
  }, []);

  const resetContext = useCallback(() => setContext(emptyContext), []);

  const options = useMemo(
    () => ({
      grades: optionsQuery.data?.grades || [],
      academicYears: optionsQuery.data?.academicYears || [],
      classes: optionsQuery.data?.classes || [],
    }),
    [
      optionsQuery.data?.grades,
      optionsQuery.data?.academicYears,
      optionsQuery.data?.classes,
    ],
  );

  // List responses carry join_academic_year_id, not the year name.
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
          "flex min-w-0 flex-col overflow-hidden border border-[var(--mws-line)] bg-white",
          isFullscreen
            ? "h-screen w-screen rounded-none border-0 shadow-none"
            : "h-[calc(100vh-16rem)] min-h-[520px] rounded-2xl shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]",
        )}
      >
        <WorkspaceToolbar
          context={context}
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
              context={context}
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
