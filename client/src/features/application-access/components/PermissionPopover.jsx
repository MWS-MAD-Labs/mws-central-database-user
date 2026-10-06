import { groupPermissions } from "../utils/groupSummary.js";
import { ListPopover } from "./ListPopover.jsx";

// "15 permissions" that opens a readable list, grouped by area. `compact` shows only the count.
export function PermissionPopover({ permissions, compact = false, className = "" }) {
  const count = permissions.length;
  return (
    <ListPopover
      label={`${count} permission${count === 1 ? "" : "s"}`}
      count={count}
      dialogLabel="Permissions"
      compact={compact}
      className={className}
      groups={groupPermissions(permissions).map((group) => ({ title: group.area, items: group.items }))}
    />
  );
}
