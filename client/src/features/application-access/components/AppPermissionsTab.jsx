import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useApplicationPermissions } from "../hooks/useApplicationPermissions.js";

function syncedText(value) {
  return value ? `Last published ${new Date(value).toLocaleString()}` : "Not published by the application yet";
}

export function AppPermissionsTab({ applicationId }) {
  const query = useApplicationPermissions(applicationId);
  if (query.isLoading) return <PanelMessage>Loading permissions…</PanelMessage>;
  if (query.isError) return <PanelMessage tone="error">The permissions could not be loaded.</PanelMessage>;
  const { permissions, has_manifest: hasManifest, last_synced_at: syncedAt } = query.data;

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
      {permissions.length === 0 ? (
        <PanelMessage>No permissions registered yet. Add one when you create a role.</PanelMessage>
      ) : (
        <DenseTable
          minWidth={760}
          head={
            <>
              <th className="px-4 py-2.5">Permission</th>
              <th className="px-4 py-2.5">What it opens</th>
              <th className="px-4 py-2.5">Needs</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5 text-center">Roles</th>
              <th className="px-4 py-2.5">Status</th>
            </>
          }
        >
          {permissions.map((permission) => (
            <tr key={permission.key} className={denseRowClass}>
              <td className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}>{permission.key}</td>
              <td className={denseCellClass}>{permission.description || "-"}</td>
              <td className={denseCellClass}>{permission.requires?.length ? permission.requires.join(", ") : "-"}</td>
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
