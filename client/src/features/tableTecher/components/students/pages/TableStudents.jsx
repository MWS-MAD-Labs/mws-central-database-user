import { useQuery } from "@tanstack/react-query";
import { Braces, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../../../components/ui/Button.jsx";
import { StatusBadge } from "../../../../../components/ui/StatusBadge.jsx";
import { WorkspaceGrid } from "../../WorkspaceGrid.jsx";
import { fetchAllStudents } from "../api/workspaceStudentsApi.js";
import { studentColumns } from "../utils/studentColumns.js";

const RAW_PREVIEW_ROWS = 5;

export function TableStudents({ context, academicYearsById }) {
  const [showRawResponse, setShowRawResponse] = useState(false);
  // Local cell edits, keyed by `${studentId}:${columnKey}`. Nothing is sent
  // to the server yet - working state and batch save are later phases.
  const [edits, setEdits] = useState({});

  const queryParams = useMemo(
    () => ({
      search: context.search,
      join_academic_year_id: context.academicYearId,
      current_grade_id: context.gradeId,
      current_class_id: context.classId,
      sort_by: "full_name",
      sort_order: "asc",
    }),
    [
      context.search,
      context.academicYearId,
      context.gradeId,
      context.classId,
    ],
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

  const getCellValue = useCallback(
    (student, column) => {
      const edit = edits[`${student.id}:${column.key}`];
      return edit !== undefined ? edit : column.value(student, lookup);
    },
    [edits, lookup],
  );

  const isCellDirty = useCallback(
    (student, column) => edits[`${student.id}:${column.key}`] !== undefined,
    [edits],
  );

  const handleCellCommit = useCallback(
    ({ row, column, value }) => {
      const key = `${row.id}:${column.key}`;
      const original = column.value(row, lookup);
      const isBackToOriginal = value === toText(original);

      setEdits((current) => {
        if (isBackToOriginal) {
          if (current[key] === undefined) return current;
          const next = { ...current };
          delete next[key];
          return next;
        }

        if (current[key] === value) return current;
        return { ...current, [key]: value };
      });
    },
    [lookup],
  );

  const editCount = Object.keys(edits).length;
  const rawPreview = useMemo(() => {
    if (!studentsQuery.data) return null;
    return {
      ...studentsQuery.data,
      data: students.slice(0, RAW_PREVIEW_ROWS),
    };
  }, [students, studentsQuery.data]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--mws-line)] px-4 py-2">
        <p className="text-xs text-[var(--mws-muted)]">
          {students.length} row(s) loaded
          {studentsQuery.data?.truncated
            ? " - capped at 5000, narrow the filters to see the rest"
            : ""}
        </p>

        <div className="flex items-center gap-2">
          {editCount > 0 ? (
            <>
              <StatusBadge tone="amber">
                {editCount} unsaved cell(s)
              </StatusBadge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEdits({})}
              >
                <Undo2 size={14} />
                Discard
              </Button>
            </>
          ) : (
            <StatusBadge tone={studentsQuery.isFetching ? "amber" : "green"}>
              {studentsQuery.isFetching ? "Syncing" : "Live"}
            </StatusBadge>
          )}

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
        getRowId={(student) => student.id}
        getCellValue={getCellValue}
        onCellCommit={handleCellCommit}
        isCellDirty={isCellDirty}
        isLoading={studentsQuery.isLoading}
        isError={studentsQuery.isError}
        errorMessage={studentsQuery.error?.message}
        emptyMessage="No students match the current workspace context."
      />
    </div>
  );
}

function toText(value) {
  return value === null || value === undefined ? "" : String(value);
}
