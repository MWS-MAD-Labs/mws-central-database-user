import { useState } from "react";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { DebouncedSearchInput } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useApplicationPermissions } from "../hooks/useApplicationPermissions.js";
import { NameList } from "./NameList.jsx";

function syncedText(value) {
  return value ? `Last published ${new Date(value).toLocaleString()}` : "Not published by the application yet";
}

export function AppPermissionsTab({ applicationId }) {
  const query = useApplicationPermissions(applicationId);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  if (query.isLoading) return <PanelMessage>Loading permissions…</PanelMessage>;
  if (query.isError) return <PanelMessage tone="error">The permissions could not be loaded.</PanelMessage>;
  const { permissions, has_manifest: hasManifest, last_synced_at: syncedAt } = query.data;

  const needle = search.trim().toLowerCase();
  const matching = needle
    ? permissions.filter(
        (permission) =>
          permission.key.toLowerCase().includes(needle) || (permission.description || "").toLowerCase().includes(needle),
      )
    : permissions;
  const totalPage = Math.max(Math.ceil(matching.length / size), 1);
  const currentPage = Math.min(page, totalPage);
  const visible = matching.slice((currentPage - 1) * size, currentPage * size);
  const neededBy = (key) =>
    permissions.filter((permission) => permission.requires?.includes(key)).map((permission) => permission.key);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
          Permissions
          <span className="ml-2 text-sm font-normal text-(--mws-muted)">{permissions.length}</span>
        </h2>
        <p className="text-sm text-(--mws-muted)">
          {hasManifest
            ? `${applicationId} publishes these from its code. ${syncedText(syncedAt)}.`
            : `${applicationId} has not published its permissions. They were added here by hand, so they are not checked against its code.`}
        </p>
      </div>
      {permissions.length > 5 ? (
        <div className="w-full sm:w-80">
          <DebouncedSearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search permissions"
          />
        </div>
      ) : null}
      {permissions.length === 0 ? (
        <PanelMessage>No permissions registered yet. Add one when you create a role.</PanelMessage>
      ) : matching.length === 0 ? (
        <PanelMessage>No permission matches this search.</PanelMessage>
      ) : (
        <DenseTable
          minWidth={860}
          head={
            <>
              <th className="px-4 py-2.5">Permission</th>
              <th className="px-4 py-2.5">What It Opens</th>
              <th className="px-4 py-2.5">Needs</th>
              <th className="px-4 py-2.5">Needed By</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5 text-center">Roles</th>
              <th className="px-4 py-2.5">Status</th>
            </>
          }
          footer={
            <PaginationBar
              paging={{ current_page: currentPage, total_page: totalPage, total_item: matching.length, size }}
              itemLabel="permissions"
              onPrevious={() => setPage(Math.max(currentPage - 1, 1))}
              onNext={() => setPage(currentPage + 1)}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setSize(next);
                setPage(1);
              }}
            />
          }
        >
          {visible.map((permission) => (
            <tr key={permission.key} className={denseRowClass}>
              <td className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}>{permission.key}</td>
              <td className={denseCellClass}>{permission.description || "-"}</td>
              <td className={denseCellClass}>
                <NameList
                  names={permission.requires || []}
                  noun="permissions"
                  title={`${permission.key} needs`}
                  plain="-"
                />
              </td>
              <td className={denseCellClass}>
                <NameList
                  names={neededBy(permission.key)}
                  noun="permissions"
                  title={`Needed by ${permission.key}`}
                  plain="-"
                />
              </td>
              <td className={denseCellClass}>{permission.source === "MANIFEST" ? "Application" : "Added by hand"}</td>
              <td className={`${denseCellClass} text-center`}>{permission.role_count}</td>
              <td className={denseCellClass}>
                <StatusBadge tone={permission.deprecated ? "neutral" : "green"}>
                  {permission.deprecated ? "Dropped" : "Current"}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </DenseTable>
      )}
    </div>
  );
}
