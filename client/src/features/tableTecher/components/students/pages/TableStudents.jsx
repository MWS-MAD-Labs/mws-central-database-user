import { useQuery } from "@tanstack/react-query";
import { Braces } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../../components/ui/Button.jsx";
import { StatusBadge } from "../../../../../components/ui/StatusBadge.jsx";
import { WorkspaceGrid } from "../../WorkspaceGrid.jsx";
import { fetchAllStudents } from "../api/workspaceStudentsApi.js";
import { studentColumns } from "../utils/studentColumns.js";

const RAW_PREVIEW_ROWS = 5;

const getStudentId = (student) => student.id;

export function TableStudents({ context, academicYearsById }) {
  const [showRawResponse, setShowRawResponse] = useState(false);

  const queryParams = useMemo(
    () => ({
      search: context.search,
      join_academic_year_id: context.academicYearId,
      current_grade_id: context.gradeId,
      current_class_id: context.classId,
      sort_by: "full_name",
      sort_order: "asc",
    }),
    [context.search, context.academicYearId, context.gradeId, context.classId],
  );

  const studentsQuery = useQuery({
    queryKey: ["workspace", "students", queryParams],
    queryFn: async () => {
      const response = await fetchAllStudents(queryParams);
      console.log("[Workspace Students] API response:", response);
      return response;
    },
    placeholderData: (previous) => previous,
  });

  // Debug logging while the grid is still being shaped around the real
  // response. Drop this once the columns are settled.
  useEffect(() => {
    console.log("[Workspace Students] query:", {
      status: studentsQuery.status,
      isFetching: studentsQuery.isFetching,
      params: queryParams,
    });

    if (studentsQuery.error) {
      console.error("[Workspace Students] error:", studentsQuery.error);
    }

    if (studentsQuery.data) {
      console.log("[Workspace Students] final response:", studentsQuery.data);
    }
  }, [
    studentsQuery.status,
    studentsQuery.isFetching,
    studentsQuery.data,
    studentsQuery.error,
    queryParams,
  ]);

  const students = useMemo(
    () => studentsQuery.data?.data || [],
    [studentsQuery.data?.data],
  );

  const lookup = useMemo(
    () => ({ academicYearsById: academicYearsById || {} }),
    [academicYearsById],
  );

  const getCellValue = useMemo(
    () => (student, column) => column.value(student, lookup),
    [lookup],
  );

  const rawPreview = useMemo(() => {
    if (!showRawResponse || !studentsQuery.data) return null;
    return {
      ...studentsQuery.data,
      data: students.slice(0, RAW_PREVIEW_ROWS),
    };
  }, [showRawResponse, students, studentsQuery.data]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--mws-line)] px-4 py-2">
        <p className="text-xs text-[var(--mws-muted)]">
          {students.length} row(s) loaded
          {studentsQuery.data?.truncated
            ? ", capped at 5000, narrow the filters to see the rest"
            : ""}
        </p>

        <div className="flex items-center gap-2">
          <StatusBadge tone={studentsQuery.isFetching ? "amber" : "green"}>
            {studentsQuery.isFetching ? "Syncing" : "Live"}
          </StatusBadge>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowRawResponse((current) => !current)}
          >
            <Braces size={14} />
            {showRawResponse ? "Hide raw JSON" : "Raw JSON"}
          </Button>
        </div>
      </div>

      {showRawResponse ? (
        <pre className="max-h-64 shrink-0 overflow-auto border-b border-[var(--mws-line)] bg-[var(--mws-soft)] p-4 text-xs text-[var(--mws-charcoal)]">
          {JSON.stringify(rawPreview, null, 2)}
        </pre>
      ) : null}

      <WorkspaceGrid
        columns={studentColumns}
        rows={students}
        getRowId={getStudentId}
        getCellValue={getCellValue}
        isLoading={studentsQuery.isLoading}
        isError={studentsQuery.isError}
        errorMessage={studentsQuery.error?.message}
        emptyMessage="No students match the current workspace context."
      />
    </div>
  );
}
