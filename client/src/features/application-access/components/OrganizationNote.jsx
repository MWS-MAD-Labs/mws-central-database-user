import { useOrganizations } from "../hooks/useOrganizations.js";
import { CopyableId } from "./CopyableId.jsx";

// The organization of an application is generated, never typed. Click it to copy.
export function OrganizationNote({ applicationId }) {
  const query = useOrganizations();
  const organization = (query.data || []).find((item) => item.application_id === applicationId);

  return (
    <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">Organization ID</p>
      {!applicationId ? (
        <p className="mt-1 text-sm text-(--mws-muted)">
          Pick an application to see its Organization ID. It is created automatically.
        </p>
      ) : organization ? (
        <>
          <div className="mt-1">
            <CopyableId value={organization.organization_id} />
          </div>
          <p className="mt-1 text-xs text-(--mws-muted)">
            Click to copy. Map this value in {applicationId} so it recognises the organization.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-(--mws-muted)">
          It is created automatically the first time {applicationId} gets a role or access.
        </p>
      )}
    </div>
  );
}
