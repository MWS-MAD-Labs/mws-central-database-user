import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import {
  DebouncedSearchInput,
  FilterSelect,
} from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { DataTransferActions } from "../../import-export/components/DataTransferActions.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { loadStudentFormOptions } from "../api/studentFormOptions.js";
import { studentsApi, studentStatuses } from "../api/studentsApi.js";
import { StudentsTable } from "../components/StudentsTable.jsx";
import { useStudentsSearchParams } from "../hooks/useStudentsSearchParams.js";
import { formatStatus } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";

export function StudentsPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useStudentsSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedStudentIds, setSelectedStudentIds] = useState(() => new Set());

  const queryParams = useMemo(
    () => ({
      page: params.page,
      size: params.size,
      search: params.search,
      status: params.status,
      current_grade_id: params.current_grade_id,
      current_class_id: params.current_class_id,
      join_academic_year_id: params.join_academic_year_id,
      is_deleted: params.is_deleted,
      sort_by: params.sort_by,
      sort_order: params.sort_order,
    }),
    [params],
  );

  const studentsQuery = useQuery({
    queryKey: ["students", queryParams],
    queryFn: () => studentsApi.list(queryParams),
  });

  const optionsQuery = useQuery({
    queryKey: ["student-form-options"],
    queryFn: loadStudentFormOptions,
  });

  const restoreMutation = useMutation({
    mutationFn: studentsApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) =>
      action === "restore"
        ? studentsApi.bulkRestore(ids)
        : studentsApi.bulkRemove(ids),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      setSelectedStudentIds(new Set());

      const actionLabel =
        variables.action === "restore" ? "restored" : "archived";
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} student(s) ${actionLabel}.`);
      }
      if (result.failed_count > 0) {
        showErrorToast(
          `${result.failed_count} student(s) failed to ${variables.action}.`,
        );
      }
    },
  });

  const paging = studentsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  };

  const yearsById = useMemo(() => {
    return Object.fromEntries(
      (optionsQuery.data?.academicYears || []).map((year) => [
        year.id,
        year.name,
      ]),
    );
  }, [optionsQuery.data?.academicYears]);

  const isTrash = params.is_deleted === "true";
  const canWrite = user?.type === "admin" && user?.role !== "VIEWER";
  const canRestore = user?.role === "SUPER_ADMIN";
  const canImport = user?.role === "SUPER_ADMIN";
  const canBulkManage = user?.role === "SUPER_ADMIN";
  const students = useMemo(
    () => studentsQuery.data?.data || [],
    [studentsQuery.data?.data],
  );
  const visibleStudentIds = useMemo(
    () => students.map((student) => student.id),
    [students],
  );
  const selectedCount = selectedStudentIds.size;
  const allVisibleSelected =
    visibleStudentIds.length > 0 &&
    visibleStudentIds.every((id) => selectedStudentIds.has(id));
  const hasActiveFilters = Boolean(
    params.search ||
    params.status ||
    params.current_grade_id ||
    params.current_class_id ||
    params.join_academic_year_id ||
    params.is_deleted,
  );

  const handleRestore = useCallback(
    (studentId) => {
      restoreMutation.mutate(studentId);
    },
    [restoreMutation],
  );

  const clearSelection = useCallback(() => {
    setSelectedStudentIds(new Set());
  }, []);

  const toggleSelected = useCallback((studentId) => {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(async () => {
    if (visibleStudentIds.length === 0) return;

    if (allVisibleSelected) {
      setSelectedStudentIds(new Set());
      return;
    }

    if (!hasActiveFilters) {
      setSelectedStudentIds(new Set(visibleStudentIds));
      return;
    }

    const limit = Math.min(paging.total_item || params.size, 100);
    const response = await studentsApi.list({
      ...queryParams,
      page: 1,
      size: limit,
    });
    setSelectedStudentIds(
      new Set((response.data || []).map((student) => student.id)),
    );
    if ((paging.total_item || 0) > 100) {
      showErrorToast(
        "Bulk action can select up to 100 filtered students at once.",
      );
    }
  }, [
    allVisibleSelected,
    hasActiveFilters,
    paging.total_item,
    params.size,
    queryParams,
    visibleStudentIds,
  ]);

  const resetPageAndClearSelection = useCallback(
    (nextParams) => {
      setSelectedStudentIds(new Set());
      resetPageAndUpdate(nextParams);
    },
    [resetPageAndUpdate],
  );

  const updateParamsAndClearSelection = useCallback(
    (nextParams) => {
      setSelectedStudentIds(new Set());
      updateParams(nextParams);
    },
    [updateParams],
  );

  function runBulkAction(action) {
    const ids = Array.from(selectedStudentIds);
    if (ids.length === 0) return;

    if (
      action === "delete" &&
      !window.confirm(`Archive ${ids.length} selected student(s)?`)
    ) {
      return;
    }

    bulkMutation.mutate({ action, ids });
  }

  function handleSort(column, nextOrder) {
    resetPageAndClearSelection({ sort_by: column, sort_order: nextOrder });
  }

  function resetFilters() {
    resetPageAndClearSelection({
      search: "",
      status: "",
      current_grade_id: "",
      current_class_id: "",
      join_academic_year_id: "",
      is_deleted: "",
      sort_by: "",
      sort_order: "",
    });
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Students"
        description="Maintain active, transferred, graduated, and archived student records."
        actions={
          <>
            <DataTransferActions
              entity="students"
              exportParams={queryParams}
              canImport={canImport}
              canExport={user?.type === "admin"}
            />
            {canWrite ? (
              <Button asChild>
                <Link to="/students/new">
                  <Plus size={16} />
                  New student
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <Plus size={16} />
                New student
              </Button>
            )}
          </>
        }
      />

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="border-b border-[var(--mws-line)] p-4">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search name, email, NIS, or NISN"
              className="xl:max-w-lg"
              onChange={(search) => resetPageAndClearSelection({ search })}
            />

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StatusBadge tone={studentsQuery.isFetching ? "amber" : "green"}>
                {studentsQuery.isFetching ? "Syncing" : "Live"}
              </StatusBadge>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={resetFilters}
              >
                <RotateCcw size={15} />
                Reset
              </Button>
            </div>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7">
            <FilterSelect
              label="Status"
              value={params.status}
              onChange={(value) =>
                resetPageAndClearSelection({ status: value })
              }
              options={[
                { value: "", label: "All statuses" },
                ...statusOptions(studentStatuses),
              ]}
            />

            <FilterSelect
              label="Grade"
              value={params.current_grade_id}
              onChange={(value) =>
                resetPageAndClearSelection({ current_grade_id: value })
              }
              options={[
                { value: "", label: "All grades" },
                ...gradeOptions(optionsQuery.data?.grades || []),
              ]}
            />

            <FilterSelect
              label="Class"
              value={params.current_class_id}
              onChange={(value) =>
                resetPageAndClearSelection({ current_class_id: value })
              }
              options={[
                { value: "", label: "All classes" },
                ...classOptions(optionsQuery.data?.classes || []),
              ]}
            />

            <FilterSelect
              label="Join Year"
              value={params.join_academic_year_id}
              onChange={(value) =>
                resetPageAndClearSelection({ join_academic_year_id: value })
              }
              options={[
                { value: "", label: "All join years" },
                ...academicYearOptions(optionsQuery.data?.academicYears || []),
              ]}
            />

            <FilterSelect
              label="Records"
              value={params.is_deleted}
              onChange={(value) =>
                resetPageAndClearSelection({ is_deleted: value })
              }
              options={[
                { value: "", label: "Active records" },
                { value: "true", label: "Trash bin" },
              ]}
            />
          </div>
        </div>

        <BulkActionBar selectedCount={selectedCount} onClear={clearSelection}>
          {isTrash ? (
            <Button
              type="button"
              size="sm"
              disabled={!canBulkManage || bulkMutation.isPending}
              onClick={() => runBulkAction("restore")}
            >
              <RotateCcw size={15} />
              Restore selected
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={!canBulkManage || bulkMutation.isPending}
              onClick={() => runBulkAction("delete")}
            >
              <Trash2 size={15} />
              Archive selected
            </Button>
          )}
        </BulkActionBar>

        <StudentsTable
          students={students}
          yearsById={yearsById}
          sortBy={params.sort_by}
          sortOrder={params.sort_order}
          onSort={handleSort}
          isLoading={studentsQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
          canSelect={canBulkManage}
          selectedIds={selectedStudentIds}
          onToggleSelected={toggleSelected}
          onToggleAll={toggleAllVisible}
          allSelected={allVisibleSelected}
        />

        <PaginationBar
          paging={paging}
          itemLabel="students"
          isLoading={studentsQuery.isLoading}
          onPrevious={() =>
            updateParamsAndClearSelection({ page: params.page - 1 })
          }
          onNext={() =>
            updateParamsAndClearSelection({ page: params.page + 1 })
          }
          onPageSizeChange={(size) =>
            updateParamsAndClearSelection({ page: 1, size })
          }
        />
      </div>
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
    badge: formatStatus(year.status),
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}

function statusOptions(statuses) {
  return statuses.map((status) => ({ value: status, label: formatStatus(status) }));
}
