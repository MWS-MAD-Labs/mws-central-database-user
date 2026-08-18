import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ImagePlus,
  Plus,
  RotateCcw,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
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
import { BulkPhotoUploadDialog } from "../components/BulkPhotoUploadDialog.jsx";
import { StudentsTable } from "../components/StudentsTable.jsx";
import { useStudentsSearchParams } from "../hooks/useStudentsSearchParams.js";
import { formatStatus } from "../../../lib/format.js";
import {
  showBulkFailureToast,
  showErrorToast,
  showSuccessToast,
} from "../../../lib/toast.js";

export function StudentsPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useStudentsSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
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

  const BULK_ACTION_LABELS = {
    restore: "restored",
    delete: "archived",
    deactivate: "deactivated",
    reactivate: "reactivated",
  };

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) => {
      if (action === "restore") return studentsApi.bulkRestore(ids);
      if (action === "deactivate") return studentsApi.bulkDeactivate(ids);
      if (action === "reactivate") return studentsApi.bulkReactivate(ids);
      return studentsApi.bulkRemove(ids);
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      setSelectedStudentIds(new Set());

      const actionLabel = BULK_ACTION_LABELS[variables.action];
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} student(s) ${actionLabel}.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast(
          `student(s) failed to ${variables.action}`,
          result,
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
  const canWrite =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_write_data));
  const canRestore = user?.role === "SUPER_ADMIN";
  const canImport = user?.role === "SUPER_ADMIN";
  const canBulkManage = user?.role === "SUPER_ADMIN";
  // Mirrors student-photo-service.ts's assertWriteAllowed - photo writes
  // need can_write_data AND can_view_sensitive_data, not just the former.
  const canManagePhotos =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" &&
      Boolean(user?.can_write_data) &&
      Boolean(user?.can_view_sensitive_data));
  const [bulkPhotoDialogOpen, setBulkPhotoDialogOpen] = useState(false);
  const students = useMemo(
    () => studentsQuery.data?.data || [],
    [studentsQuery.data?.data],
  );
  const visibleStudentIds = useMemo(
    () => students.map((student) => student.id),
    [students],
  );
  const selectedCount = selectedStudentIds.size;
  // Only checks against the currently loaded page - a selection that spans
  // multiple pages can't be evaluated for statuses not on this page, so
  // those just don't count toward either side rather than guessing.
  const hasSelectedActive = students.some(
    (student) =>
      selectedStudentIds.has(student.id) && student.status === "ACTIVE",
  );
  const hasSelectedInactive = students.some(
    (student) =>
      selectedStudentIds.has(student.id) && student.status === "INACTIVE",
  );
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

  async function runBulkAction(action) {
    const ids = Array.from(selectedStudentIds);
    if (ids.length === 0) return;

    if (
      action === "delete" &&
      !(await confirm({
        title: "Archive students",
        description: `Archive ${ids.length} selected student(s)?`,
        confirmLabel: "Archive",
        tone: "danger",
      }))
    ) {
      return;
    }

    if (
      action === "deactivate" &&
      !(await confirm({
        title: "Deactivate students",
        description: `Deactivate ${ids.length} selected student(s)? Their class enrollments stay exactly as they are - this only flags them as inactive.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      }))
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
            {canManagePhotos ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBulkPhotoDialogOpen(true)}
              >
                <ImagePlus size={16} />
                Bulk Photo Upload
              </Button>
            ) : null}
            {canWrite ? (
              <Button asChild>
                <Link to="/students/new">
                  <Plus size={16} />
                  New Student
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <Plus size={16} />
                New Student
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
              placeholder="Search Name, Email, NIS, Or NISN"
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
                { value: "", label: "All Statuses" },
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
                { value: "", label: "All Grades" },
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
                { value: "", label: "All Classes" },
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
                { value: "", label: "All Join Years" },
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
                { value: "", label: "Active Records" },
                { value: "true", label: "Trash bin" },
              ]}
            />
          </div>
        </div>

        <BulkActionBar selectedCount={selectedCount} onClear={clearSelection}>
          {isTrash ? (
            <ActionsMenu
              label="Bulk Actions"
              disabled={!canBulkManage || bulkMutation.isPending}
            >
              {(closeMenu) => (
                <ActionsMenuItem
                  disabled={!canBulkManage || bulkMutation.isPending}
                  onClick={() => {
                    closeMenu();
                    runBulkAction("restore");
                  }}
                >
                  <span className="flex items-center gap-2">
                    <RotateCcw size={15} />
                    Restore selected
                  </span>
                </ActionsMenuItem>
              )}
            </ActionsMenu>
          ) : (
            <ActionsMenu label="Bulk Actions">
              {(closeMenu) => (
                <>
                  <div className="px-3 pb-1 pt-2 font-display text-xs font-bold text-[var(--mws-muted)]">
                    Set status
                  </div>
                  <ActionsMenuItem
                    disabled={
                      !canWrite || !hasSelectedActive || bulkMutation.isPending
                    }
                    title={
                      canWrite && !hasSelectedActive
                        ? "No Active student is selected."
                        : undefined
                    }
                    onClick={() => {
                      closeMenu();
                      runBulkAction("deactivate");
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <UserX size={15} />
                      Deactivate selected
                    </span>
                  </ActionsMenuItem>
                  <ActionsMenuItem
                    disabled={
                      !canWrite ||
                      !hasSelectedInactive ||
                      bulkMutation.isPending
                    }
                    title={
                      canWrite && !hasSelectedInactive
                        ? "No Inactive student is selected."
                        : undefined
                    }
                    onClick={() => {
                      closeMenu();
                      runBulkAction("reactivate");
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <UserCheck size={15} />
                      Reactivate selected
                    </span>
                  </ActionsMenuItem>
                  <div className="my-1 border-t border-[var(--mws-line)]" />
                  <ActionsMenuItem
                    tone="danger"
                    disabled={!canBulkManage || bulkMutation.isPending}
                    onClick={() => {
                      closeMenu();
                      runBulkAction("delete");
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Trash2 size={15} />
                      Archive selected
                    </span>
                  </ActionsMenuItem>
                </>
              )}
            </ActionsMenu>
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

      {bulkPhotoDialogOpen ? (
        <BulkPhotoUploadDialog onClose={() => setBulkPhotoDialogOpen(false)} />
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
  return statuses.map((status) => ({
    value: status,
    label: formatStatus(status),
  }));
}
