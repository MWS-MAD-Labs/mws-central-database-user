import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  ImagePlus,
  PencilLine,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { BulkResultDialog } from "../../../components/ui/BulkResultDialog.jsx";
import { RestoreConfirmationDialog } from "../../../components/ui/RestoreConfirmationDialog.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
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
import { useBulkSelection } from "../../../lib/useBulkSelection.js";
import { showBulkFailureToast, showSuccessToast } from "../../../lib/toast.js";

export function EmployeesPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useEmployeesSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [bulkExtendIds, setBulkExtendIds] = useState(null);
  const [bulkEditIds, setBulkEditIds] = useState(null);
  const [bulkPhotoDialogOpen, setBulkPhotoDialogOpen] = useState(false);
  const [bulkFailureResult, setBulkFailureResult] = useState(null);
  const [restoreEmployeeRecords, setRestoreEmployeeRecords] = useState(null);

  const queryParams = useMemo(
    () => ({
      page: params.page,
      size: params.size,
      search: params.search,
      status: params.status === "ALL" ? "" : params.status,
      employment_type: params.employment_type,
      unit_id: params.unit_id,
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
    meta: { successMessage: "Employee restored." },
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
      clearSelection();

      const actionLabel =
        variables.action === "restore" ? "restored" : "archived";
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} employee(s) ${actionLabel}.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast(
          `employee(s) failed to ${variables.action}`,
          result,
        );
        setBulkFailureResult({
          title:
            variables.action === "restore"
              ? "Employee Restore Failures"
              : "Employee Archive Failures",
          result,
        });
      }
    },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({ ids, payload }) => employeesApi.bulkUpdate(ids, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      clearSelection();
      setBulkEditIds(null);

      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} employee(s) updated.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("employee(s) failed to update", result);
      }
    },
  });

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
    mutationFn: ({ ids, durationMonths, contractEndDate, baselineOverrides }) =>
      employeesApi.bulkExtendContract(ids, {
        durationMonths,
        contractEndDate,
        baselineOverrides,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      clearSelection();
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

  function resetFilters() {
    resetPageAndClearSelection({
      search: "",
      status: "",
      employment_type: "",
      unit_id: "",
      building_id: "",
      is_deleted: "",
      sort_by: "",
      sort_order: "",
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
  const hasActiveFilters = Boolean(
    params.search ||
    params.status !== "ACTIVE" ||
    params.employment_type ||
    params.unit_id ||
    params.building_id ||
    params.is_deleted,
  );
  const {
    selectedIds: selectedEmployeeIds,
    selectedCount,
    allVisibleSelected,
    clearSelection,
    toggleSelected,
    toggleAllVisible,
  } = useBulkSelection({
    listFn: employeesApi.list,
    queryParams,
    visibleIds: visibleEmployeeIds,
    hasActiveFilters,
    paging,
    pageSize: params.size,
    entityLabel: "employees",
  });

  function handleRestore(employeeId) {
    const employee = employees.find((item) => item.id === employeeId);
    if (employee) setRestoreEmployeeRecords([employee]);
  }

  function resetPageAndClearSelection(nextParams) {
    clearSelection();
    resetPageAndUpdate(nextParams);
  }

  function updateParamsAndClearSelection(nextParams) {
    clearSelection();
    updateParams(nextParams);
  }

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
    if (!ids || ids.length === 0) return;
    bulkEditMutation.mutate({ ids, payload });
  }

  function openBulkExtendDialog() {
    const ids = Array.from(selectedEmployeeIds);
    if (ids.length === 0) return;
    setBulkExtendIds(ids);
  }

  function runBulkExtendContract(
    { durationMonths, contractEndDate, baselineOverrides },
    includedIds,
  ) {
    if (!includedIds || includedIds.length === 0) return;
    if (!durationMonths && !contractEndDate) return;

    bulkExtendMutation.mutate({
      ids: includedIds,
      durationMonths,
      contractEndDate,
      baselineOverrides,
    });
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Staff & Teachers"
        description="Manage employee records, work assignments, and profile authority data."
        actions={
          <>
            <DataTransferActions
              entity="employees"
              exportParams={queryParams}
              canImport={canImport}
              canExport={canWrite}
              canExportSensitive={
                user?.role === "SUPER_ADMIN" ||
                Boolean(user?.can_view_employee_pii)
              }
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

      <div className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="border-b border-(--mws-line) p-4">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search Employees"
              className="xl:max-w-lg"
              onChange={(search) => resetPageAndClearSelection({ search })}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <LiveIndicator isSyncing={employeesQuery.isFetching} />
              <FilterResetButton
                visible={hasActiveFilters}
                onReset={resetFilters}
              />
            </div>
          </div>

          <div className="mt-4 flex min-w-0 flex-wrap gap-3">
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
                { value: "ALL", label: "All Statuses" },
                ...statusOptions(employeeStatuses),
              ]}
            />
            <FilterSelect
              label="Records"
              value={params.is_deleted}
              onChange={(value) =>
                resetPageAndClearSelection({ is_deleted: value, status: "" })
              }
              options={[
                { value: "", label: "Active Records" },
                { value: "true", label: "Trash Bin" },
              ]}
            />
            <FilterSelect
              label="Unit"
              value={params.unit_id}
              onChange={(value) =>
                resetPageAndClearSelection({ unit_id: value })
              }
              options={[
                { value: "", label: "All Units" },
                ...unitOptions(optionsQuery.data?.units || []),
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
                    setRestoreEmployeeRecords(
                      employees.filter((employee) =>
                        selectedEmployeeIds.has(employee.id),
                      ),
                    );
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
                  <div className="my-1 border-t border-(--mws-line)" />
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
                  <div className="my-1 border-t border-(--mws-line)" />
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

        <BulkResultDialog
          title={bulkFailureResult?.title}
          result={bulkFailureResult?.result}
          getDetailHref={(id) => `/employees/${id}`}
          onClose={() => setBulkFailureResult(null)}
        />

        <RestoreConfirmationDialog
          title="Confirm Employee Restore"
          description="Review the archived employee records before restoring them."
          records={restoreEmployeeRecords}
          columns={[
            {
              key: "name",
              label: "Name",
              render: (employee) => employee.identity.full_name,
            },
            {
              key: "employee_id",
              label: "Employee ID",
              render: (employee) => employee.employment.employee_id,
            },
            {
              key: "unit",
              label: "Unit",
              render: (employee) => employee.employment.unit || "-",
            },
            {
              key: "position",
              label: "Position",
              render: (employee) => employee.employment.job_position || "-",
            },
            {
              key: "status",
              label: "Previous Status",
              render: (employee) => formatStatus(employee.status_info.status),
            },
          ]}
          getDetailHref={(employee) => `/employees/${employee.id}`}
          isSubmitting={restoreMutation.isPending || bulkMutation.isPending}
          onClose={() => setRestoreEmployeeRecords(null)}
          onConfirm={() => {
            if (restoreEmployeeRecords.length === 1) {
              restoreMutation.mutate(restoreEmployeeRecords[0].id, {
                onSettled: () => setRestoreEmployeeRecords(null),
              });
            } else {
              bulkMutation.mutate(
                {
                  action: "restore",
                  ids: restoreEmployeeRecords.map((employee) => employee.id),
                },
                { onSettled: () => setRestoreEmployeeRecords(null) },
              );
            }
          }}
        />

        {employeesQuery.isError ? (
          <PanelMessage>Employee data is unavailable.</PanelMessage>
        ) : (
          <EmployeesTable
            employees={employees}
            sorting={sorting}
            onSortingChange={handleSortingChange}
            isLoading={employeesQuery.isLoading}
            isTrash={isTrash}
            canRestore={canRestore}
            restoringId={restoreMutation.isPending ? restoreMutation.variables : undefined}
            onRestore={handleRestore}
            canSelect={canSelectEmployees}
            selectedIds={selectedEmployeeIds}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAllVisible}
            allSelected={allVisibleSelected}
          />
        )}

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

function unitOptions(units) {
  return units.map((unit) => ({
    value: unit.id,
    label: unit.name,
  }));
}

function statusOptions(statuses) {
  return statuses.map((status) => ({
    value: status,
    label: formatStatus(status),
  }));
}
