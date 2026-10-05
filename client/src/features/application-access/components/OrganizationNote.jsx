import { Copy } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { useOrganizations } from "../hooks/useOrganizations.js";
import { copyText } from "../utils/copyText.js";

// The organization of an application is generated, never typed.
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
          <div className="mt-1 flex items-center justify-between gap-2">
            <code className="min-w-0 truncate text-sm font-semibold text-(--mws-charcoal)">
              {organization.organization_id}
            </code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Copy Organization ID"
              onClick={() => copyText(organization.organization_id)}
            >
              <Copy size={14} />
              Copy
            </Button>
          </div>
          <p className="mt-1 text-xs text-(--mws-muted)">
            Map this value in {applicationId} so it recognises the organization.
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
