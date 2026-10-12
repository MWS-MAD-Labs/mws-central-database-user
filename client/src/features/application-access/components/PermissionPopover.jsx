import { groupPermissions } from "../utils/groupSummary.js";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";
import { useApplicationPermissions } from "../hooks/useApplicationPermissions.js";

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// "15 permissions" that opens a readable list, grouped by area, each with what it lets a person do when the
// application said so. `compact` shows only the count.
export function PermissionPopover({ permissions, applicationId, compact = false, className = "" }) {
  const count = permissions.length;
  const registry = useApplicationPermissions(applicationId);
  const descriptions = new Map((registry.data?.permissions ?? []).map((item) => [item.key, item.description]));
  return (
    <ListPopover
      label={`${count} permission${count === 1 ? "" : "s"}`}
      count={count}
      dialogLabel="Permissions"
      compact={compact}
      className={className}
      groups={groupPermissions(permissions).map((group) => ({
        title: capital(group.area),
        items: group.items.map((key) => ({ label: key, hint: descriptions.get(key) || null })),
      }))}
    />
  );
}
