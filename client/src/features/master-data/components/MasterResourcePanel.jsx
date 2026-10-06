import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/hooks/useAuth";
import { useState } from "react";
import { defaultPaging } from "../utils/params";
import { Edit, Plus, Trash2 } from "lucide-react";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDate } from "../../../lib/format.js";
import { HeaderCell } from "./HeaderCell.jsx";
import { LoadingRows } from "./LoadingRows.jsx";
import { MasterDataDialog } from "./MasterDataDialog.jsx";
import { PanelFrame } from "./PanelFrame.jsx";
import { SearchBox } from "./SearchBox.jsx";
import { invalidateMasterData } from "../utils/invalidateMasterData.js";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import { FilterSelect } from "../../../components/ui/FormControls.jsx";
import { unitsApi } from "../api/masterDataApi.js";
import { isOperationalUnit } from "../utils/pcActivityUnits.js";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";

function UnitScopeValue({ item }) {
  const names = (item.units || []).map((unit) => unit.name);
  if (names.length === 0) {
    return item.is_teaching_position || item.is_teaching_role
      ? "All Academic Units"
      : "All Units";
  }
  if (names.length === 1) return names[0];
  return (
    <ListPopover
      label={`${names.length} Units`}
      count={names.length}
      dialogLabel={`Units for ${item.name}`}
      icon={false}
      mono={false}
      groups={[{ items: names }]}
      className="[&>button]:text-sm [&>button]:text-(--mws-burgundy)"
    />
  );
}

export function MasterResourcePanel({ resource }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    unit_id: "",
    capacity_scope: "",
    sort_by: "name",
    sort_order: "asc",
  });
  const [dialog, setDialog] = useState(null);

  const query = useQuery({
    queryKey: ["master-data", resource.id, params],
    queryFn: () => resource.api.list(params),
  });
  const items = query.data?.data || [];
  const unitsQuery = useQuery({
    queryKey: ["master-data", "filter-units"],
    queryFn: () => unitsApi.list({ size: 100 }),
    enabled: Boolean(resource.unitScope),
  });

  const createMutation = useMutation({
    mutationFn: resource.api.create,
    onSuccess: () => {
      invalidateMasterData(queryClient, resource.id);
      setDialog(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => resource.api.update(id, payload),
    onSuccess: () => {
      invalidateMasterData(queryClient, resource.id);
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: resource.api.remove,
    onSuccess: () => {
      invalidateMasterData(queryClient, resource.id);
    },
  });

  const canWrite = user?.type === "admin" && user?.role === "SUPER_ADMIN";
  const paging = query.data?.paging || defaultPaging(params);
  const hasActiveFilters = Boolean(params.search || params.unit_id || params.capacity_scope);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  async function handleDelete(item) {
    if (
      await confirm({
        title: `Delete ${resource.singular.toLowerCase()}`,
        description: `"${item.name}" will be deleted.`,
        confirmLabel: "Delete",
        tone: "danger",
      })
    ) {
      deleteMutation.mutate(item.id);
    }
  }

  return (
    <PanelFrame
      title={resource.label}
      description={resource.description}
      icon={resource.icon}
      isFetching={query.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite}
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} />
          New {resource.singular}
        </Button>
      }
      toolbar={
        <div className="w-full space-y-4">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <SearchBox
              value={params.search}
              placeholder={`Search ${resource.label.toLowerCase()}`}
              onChange={(value) => resetPageAndUpdate({ search: value })}
            />
            <FilterResetButton
              visible={hasActiveFilters}
              onReset={() => resetPageAndUpdate({ search: "", unit_id: "", capacity_scope: "" })}
            />
          </div>
          {resource.unitScope || resource.positionCapacity ? (
            <div className="flex min-w-0 flex-wrap gap-3">
              {resource.unitScope ? (
                <FilterSelect
                  label="Unit"
                  value={params.unit_id}
                  onChange={(unit_id) => resetPageAndUpdate({ unit_id })}
                  options={[
                    { value: "", label: "All Units" },
                    ...(unitsQuery.data?.data || []).filter(isOperationalUnit).map((unit) => ({
                      value: unit.id,
                      label: unit.name,
                    })),
                  ]}
                />
              ) : null}
              {resource.positionCapacity ? (
                <FilterSelect
                  label="Active Holder Limit"
                  value={params.capacity_scope}
                  onChange={(capacity_scope) => resetPageAndUpdate({ capacity_scope })}
                  options={[
                    { value: "", label: "All Active Holder Limits" },
                    { value: "UNLIMITED", label: "Unlimited" },
                    { value: "PER_UNIT", label: "Per Unit" },
                    { value: "GLOBAL", label: "Global" },
                  ]}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      }
      notice={
        !canWrite
          ? "Only Super Admin can create, edit, or delete master data."
          : null
      }
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            {(resource.flags ?? []).map((flag) => (
              <th key={flag.field} className="px-4 py-3">
                {flag.checkboxLabel}
              </th>
            ))}
            {resource.unitScope ? <th className="px-4 py-3">Unit</th> : null}
            {resource.positionCapacity ? (
              <th className="px-4 py-3">Active Holder Limit</th>
            ) : null}
            <HeaderCell
              label="Created"
              column="created_at"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={query.isLoading}
            isEmpty={items.length === 0}
            colSpan={
              3 +
              (resource.flags?.length ?? 0) +
              (resource.unitScope ? 1 : 0) +
              (resource.positionCapacity ? 1 : 0)
            }
            label={resource.itemLabel}
          />
          {!query.isLoading
            ? items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-(--mws-charcoal)">
                      {item.name}
                    </div>
                    <div className="mt-0.5 text-xs text-(--mws-muted)">
                      {item.id}
                    </div>
                  </td>
                  {(resource.flags ?? []).map((flag) => (
                    <td key={flag.field} className="px-4 py-3">
                      <StatusBadge
                        tone={item[flag.field] ? "green" : "neutral"}
                      >
                        {item[flag.field]
                          ? (flag.badgeOn ?? "Yes")
                          : (flag.badgeOff ?? "No")}
                      </StatusBadge>
                    </td>
                  ))}
                  {resource.unitScope ? (
                    <td className="px-4 py-3 text-(--mws-muted)">
                      <UnitScopeValue item={item} />
                    </td>
                  ) : null}
                  {resource.positionCapacity ? (
                    <td className="px-4 py-3 text-(--mws-muted)">
                      {item.capacity_scope && item.max_active_holders
                        ? `${item.max_active_holders} ${item.capacity_scope === "PER_UNIT" ? "/ Unit" : "Global"}`
                        : "Unlimited"}
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-(--mws-muted)">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ActionsMenu
                      label={`${item.name} actions`}
                      disabled={!canWrite}
                    >
                      {(closeMenu) => (
                        <>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setDialog({ mode: "edit", record: item });
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Edit size={15} />
                              Edit
                            </span>
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            tone="danger"
                            onClick={() => {
                              closeMenu();
                              handleDelete(item);
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Trash2 size={15} />
                              Delete
                            </span>
                          </ActionsMenuItem>
                        </>
                      )}
                    </ActionsMenu>
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel={resource.itemLabel}
        isLoading={query.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <MasterDataDialog
          dialog={dialog}
          resource={resource}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === "create") createMutation.mutate(payload);
            else updateMutation.mutate({ id: dialog.record.id, payload });
          }}
        />
      ) : null}
    </PanelFrame>
  );
}
