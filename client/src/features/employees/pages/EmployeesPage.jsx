import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  ImagePlus,
  PencilLine,
  Plus,
  RotateCcw,
  Trash2,
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
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import {
  DebouncedSearchInput,
  FilterSelect,
} from "../../../components/ui/FormControls.jsx";
import { DataTransferActions } from "../../import-export/components/DataTransferActions.jsx";
import { BulkEditEmployeeDialog } from "../components/BulkEditEmployeeDialog.jsx";
import { BulkExtendContractDialog } from "../components/BulkExtendContractDialog.jsx";
import { EmployeeBulkPhotoUploadDialog } from "../components/EmployeeBulkPhotoUploadDialog.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
  employeesApi,
  employeeStatuses,
  employmentTypes,
} from "../api/employeesApi.js";
import { loadEmployeeFormOptions } from "../api/employeeFormOptions.js";
import { EmployeesTable } from "../components/EmployeesTable.jsx";
import { useEmployeesSearchParams } from "../hooks/useEmployeesSearchParams.js";
import { formatStatus } from "../../../lib/format.js";
import {
  showBulkFailureToast,
  showErrorToast,
  showSuccessToast,
} from "../../../lib/toast.js";

export function EmployeesPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useEmployeesSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(
    () => new Set(),
  );
  // Snapshotted at open time, not read live off selectedEmployeeIds - the
  // dialog's list shouldn't reshuffle if the selection changes while it's
  // still open.
  const [bulkExtendIds, setBulkExtendIds] = useState(null);
  const [bulkEditIds, setBulkEditIds] = useState(null);
  const [bulkPhotoDialogOpen, setBulkPhotoDialogOpen] = useState(false);

  const queryParams = useMemo(
    () => ({
      page: params.page,
      size: params.size,
      search: params.search,
      status: params.status,
      employment_type: params.employment_type,
      building_id: params.building_id,
      is_deleted: params.is_deleted,
      sort_by: params.sort_by,
      sort_order: params.sort_order,
    }),
    [params],
  );

  const employeesQuery = useQuery({
    queryKey: ["employees", queryParams],
    queryFn: () => employeesApi.list(queryParams),
  });

  const optionsQuery = useQuery({
    queryKey: ["employee-form-options"],
    queryFn: loadEmployeeFormOptions,
  });

  const restoreMutation = useMutation({
    mutationFn: employeesApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) =>
      action === "restore"
        ? employeesApi.bulkRestore(ids)
        : employeesApi.bulkRemove(ids),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelectedEmployeeIds(new Set());

      const actionLabel =
        variables.action === "restore" ? "restored" : "archived";
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} employee(s) ${actionLabel}.`);
      }
      if (result.failed_count > 0) {
        showErrorToast(
          `${result.failed_count} employee(s) failed to ${variables.action}.`,
        );
      }
    },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({ ids, payload }) => employeesApi.bulkUpdate(ids, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelectedEmployeeIds(new Set());
      setBulkEditIds(null);

      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} employee(s) updated.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("employee(s) failed to update", result);
      }
    },
  });

  // Full records for the bulk-extend/bulk-edit dialogs' lists -
  // selectedEmployeeIds can include ids from other pages (see
  // toggleAllVisible), which `employees` (this page only) doesn't cover, so
  // this fetches each one directly.
  const bulkExtendEmployeesQuery = useQuery({
    queryKey: ["employees", "bulk-extend-detail", bulkExtendIds],
    queryFn: () => Promise.all(bulkExtendIds.map((id) => employeesApi.get(id))),
    enabled: Boolean(bulkExtendIds?.length),
  });

  const bulkEditEmployeesQuery = useQuery({
    queryKey: ["employees", "bulk-edit-detail", bulkEditIds],
    queryFn: () => Promise.all(bulkEditIds.map((id) => employeesApi.get(id))),
    enabled: Boolean(bulkEditIds?.length),
  });

  const bulkExtendMutation = useMutation({
    mutationFn: ({ ids, durationMonths, baselineOverrides }) =>
      employeesApi.bulkExtendContract(ids, durationMonths, baselineOverrides),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelectedEmployeeIds(new Set());
      setBulkExtendIds(null);

      if (result.success_count > 0) {
        showSuccessToast(
          `${result.success_count} employee(s)' contracts extended.`,
        );
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("employee(s) failed to extend", result);
      }
    },
  });

  const sorting = useMemo(
    () => [
      {
        id: params.sort_by,
        desc: params.sort_order === "desc",
      },
    ],
    [params.sort_by, params.sort_order],
  );

  function handleSortingChange(updater) {
    const nextSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    const next = nextSorting[0];

    resetPageAndClearSelection({
      sort_by: next?.id || "created_at",
      sort_order: next?.desc ? "desc" : "asc",
    });
  }

  const paging = employeesQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  };
  const isTrash = params.is_deleted === "true";
  const canWrite =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_write_employee_data));
  const canRestore = user?.role === "SUPER_ADMIN";
  const canImport = user?.role === "SUPER_ADMIN";
  const canBulkManage = user?.role === "SUPER_ADMIN";
  // Mirrors employee-photo-service.ts's assertWriteAllowed - photo writes
  // need can_write_employee_data AND can_view_employee_pii, not just the former.
  const canManagePhotos =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" &&
      Boolean(user?.can_write_employee_data) &&
      Boolean(user?.can_view_employee_pii));
  const canSelectEmployees = isTrash
    ? canBulkManage
    : canWrite || canBulkManage;
  const employees = useMemo(
    () => employeesQuery.data?.data || [],
    [employeesQuery.data?.data],
  );
  const visibleEmployeeIds = useMemo(
    () => employees.map((employee) => employee.id),
    [employees],
  );
  const selectedCount = selectedEmployeeIds.size;
  const allVisibleSelected =
    visibleEmployeeIds.length > 0 &&
    visibleEmployeeIds.every((id) => selectedEmployeeIds.has(id));
  const hasActiveFilters = Boolean(
    params.search ||
    params.status ||
    params.employment_type ||
    params.building_id ||
    params.is_deleted,
  );

  const handleRestore = useCallback(
    (employeeId) => {
      restoreMutation.mutate(employeeId);
    },
    [restoreMutation],
  );

  const clearSelection = useCallback(() => {
    setSelectedEmployeeIds(new Set());
  }, []);

  const toggleSelected = useCallback((employeeId) => {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(async () => {
    if (visibleEmployeeIds.length === 0) return;

    if (allVisibleSelected) {
      setSelectedEmployeeIds(new Set());
      return;
    }

    if (!hasActiveFilters) {
      setSelectedEmployeeIds(new Set(visibleEmployeeIds));
      return;
    }

    const limit = Math.min(paging.total_item || params.size, 100);
    const response = await employeesApi.list({
      ...queryParams,
      page: 1,
      size: limit,
    });
    setSelectedEmployeeIds(
      new Set((response.data || []).map((employee) => employee.id)),
    );
    if ((paging.total_item || 0) > 100) {
      showErrorToast(
        "Bulk action can select up to 100 filtered employees at once.",
      );
    }
  }, [
    allVisibleSelected,
    hasActiveFilters,
    paging.total_item,
    params.size,
    queryParams,
    visibleEmployeeIds,
  ]);

  const resetPageAndClearSelection = useCallback(
    (nextParams) => {
      setSelectedEmployeeIds(new Set());
      resetPageAndUpdate(nextParams);
    },
    [resetPageAndUpdate],
  );

  const updateParamsAndClearSelection = useCallback(
    (nextParams) => {
      setSelectedEmployeeIds(new Set());
      updateParams(nextParams);
    },
    [updateParams],
  );

  async function runBulkAction(action) {
    const ids = Array.from(selectedEmployeeIds);
    if (ids.length === 0) return;

    if (
      action === "delete" &&
      !(await confirm({
        title: "Archive employees",
        description: `Archive ${ids.length} selected employee(s)?`,
        confirmLabel: "Archive",
        tone: "danger",
      }))
    ) {
      return;
    }

    bulkMutation.mutate({ action, ids });
  }

  function openBulkEditDialog() {
    const ids = Array.from(selectedEmployeeIds);
    if (ids.length === 0) return;
    setBulkEditIds(ids);
  }

  function runBulkEdit({ ids, ...payload }) {
    // ids reflects the dialog's own Exclude toggles, not necessarily every
    // id in bulkEditIds - always use what the dialog actually confirmed.
    if (!ids || ids.length === 0) return;
    bulkEditMutation.mutate({ ids, payload });
  }

  function openBulkExtendDialog() {
    const ids = Array.from(selectedEmployeeIds);
    if (ids.length === 0) return;
    setBulkExtendIds(ids);
  }

  function runBulkExtendContract(
    durationMonths,
    baselineOverrides,
    includedIds,
  ) {
    // includedIds reflects the dialog's own Exclude toggles (and its
    // automatic PERMANENT/RESIGNED skip), not necessarily every id in
    // bulkExtendIds - always use what the dialog actually confirmed.
    if (!includedIds || includedIds.length === 0 || !durationMonths) return;

    bulkExtendMutation.mutate({
      ids: includedIds,
      durationMonths,
      baselineOverrides,
    });
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Employees"
        description="Manage employee records, work assignments, and profile authority data."
        actions={
          <>
            <DataTransferActions
              entity="employees"
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
                <Link to="/employees/new">
                  <Plus size={16} />
                  New Employee
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <Plus size={16} />
                New Employee
              </Button>
            )}
          </>
        }
      />

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:max-w-lg">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search Employees"
              className="min-w-0 flex-1"
              onChange={(search) => resetPageAndClearSelection({ search })}
            />
            <StatusBadge
              tone={employeesQuery.isFetching ? "amber" : "green"}
              className="shrink-0"
            >
              {employeesQuery.isFetching ? "Syncing" : "Live"}
            </StatusBadge>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
            <FilterSelect
              label="Employment Type"
              value={params.employment_type}
              onChange={(value) =>
                resetPageAndClearSelection({ employment_type: value })
              }
              options={[
                { value: "", label: "All Employment Types" },
                ...statusOptions(employmentTypes),
              ]}
            />
            <FilterSelect
              label="Status"
              value={params.status}
              onChange={(value) =>
                resetPageAndClearSelection({ status: value })
              }
              options={[
                { value: "", label: "All Statuses" },
                ...statusOptions(employeeStatuses),
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
            <FilterSelect
              label="Building"
              value={params.building_id}
              onChange={(value) =>
                resetPageAndClearSelection({ building_id: value })
              }
              options={[
                { value: "", label: "All Buildings" },
                ...buildingOptions(optionsQuery.data?.buildings || []),
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
                  <ActionsMenuItem
                    disabled={!canWrite || bulkEditMutation.isPending}
                    onClick={() => {
                      closeMenu();
                      openBulkEditDialog();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <PencilLine size={15} />
                      Bulk edit
                    </span>
                  </ActionsMenuItem>
                  <div className="my-1 border-t border-[var(--mws-line)]" />
                  <ActionsMenuItem
                    disabled={!canWrite || bulkExtendMutation.isPending}
                    onClick={() => {
                      closeMenu();
                      openBulkExtendDialog();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarClock size={15} />
                      Extend contracts
                    </span>
                  </ActionsMenuItem>
                  <div className="my-1 border-t border-[var(--mws-line)]" />
                  <ActionsMenuItem
                    tone="danger"
                    disabled={
                      !canBulkManage ||
                      bulkMutation.isPending ||
                      bulkEditMutation.isPending
                    }
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

        {bulkExtendIds ? (
          <BulkExtendContractDialog
            employees={bulkExtendEmployeesQuery.data || []}
            isLoadingEmployees={bulkExtendEmployeesQuery.isLoading}
            isSaving={bulkExtendMutation.isPending}
            onClose={() => setBulkExtendIds(null)}
            onConfirm={runBulkExtendContract}
          />
        ) : null}

        {bulkEditIds ? (
          <BulkEditEmployeeDialog
            employees={bulkEditEmployeesQuery.data || []}
            isLoadingEmployees={bulkEditEmployeesQuery.isLoading}
            options={optionsQuery.data || {}}
            isSaving={bulkEditMutation.isPending}
            onClose={() => setBulkEditIds(null)}
            onConfirm={runBulkEdit}
          />
        ) : null}

        {bulkPhotoDialogOpen ? (
          <EmployeeBulkPhotoUploadDialog
            onClose={() => setBulkPhotoDialogOpen(false)}
          />
        ) : null}

        <EmployeesTable
          employees={employees}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          isLoading={employeesQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
          canSelect={canSelectEmployees}
          selectedIds={selectedEmployeeIds}
          onToggleSelected={toggleSelected}
          onToggleAll={toggleAllVisible}
          allSelected={allVisibleSelected}
        />

        <PaginationBar
          paging={paging}
          itemLabel="employees"
          isLoading={employeesQuery.isLoading}
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

function buildingOptions(buildings) {
  return buildings.map((building) => ({
    value: building.id,
    label: building.name,
  }));
}

function statusOptions(statuses) {
  return statuses.map((status) => ({
    value: status,
    label: formatStatus(status),
  }));
}
