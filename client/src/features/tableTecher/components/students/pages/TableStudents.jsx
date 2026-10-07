import { useQuery } from "@tanstack/react-query";
import { Braces } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../../../components/ui/Button.jsx";
import { LiveIndicator } from "../../../../../components/ui/LiveIndicator.jsx";
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
      enrolled_academic_year_id: context.academicYearId,
      current_grade_id: context.gradeId,
      current_class_id: context.classId,
      sort_by: "full_name",
      sort_order: "asc",
    }),
    [context.search, context.academicYearId, context.gradeId, context.classId],
  );

  const studentsQuery = useQuery({
    queryKey: ["workspace", "students", queryParams],
    queryFn: () => fetchAllStudents(queryParams),
    // Nothing to list before there is an academic year to list for.
    enabled: Boolean(context.academicYearId),
    placeholderData: (previous) => previous,
  });

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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-(--mws-line) px-4 py-2">
        <p className="text-xs text-(--mws-muted)">
          {students.length} row(s) loaded
          {studentsQuery.data?.truncated
            ? ", capped at 5000, narrow the filters to see the rest"
            : ""}
        </p>

        <div className="flex items-center gap-2">
          <LiveIndicator isSyncing={studentsQuery.isFetching} />

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
        <pre className="max-h-64 shrink-0 overflow-auto border-b border-(--mws-line) bg-(--mws-soft) p-4 text-xs text-(--mws-charcoal)">
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
        emptyMessage={
          context.academicYearId
            ? "No students are enrolled in this academic year with these filters."
            : "There is no academic year yet."
        }
      />
    </div>
  );
}
