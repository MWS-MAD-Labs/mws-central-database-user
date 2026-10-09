import { useQuery } from "@tanstack/react-query";
import { CheckboxField } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { apiClientsApi } from "../../api-clients/api/apiClientsApi.js";
import { REQUIRED_SCOPES } from "../utils/connectionScopes.js";
import { describeScope, groupScopes } from "../../api-clients/utils/scopes.js";

// What the application may read from Central. The two required scopes are shown but cannot be turned off.
export function ScopePicker({ value, onChange }) {
  const query = useQuery({
    queryKey: ["application-access", "connection-scopes"],
    queryFn: () => apiClientsApi.listProfileScopes(),
    staleTime: 5 * 60 * 1000,
  });
  if (query.isLoading) return <p className="text-sm text-(--mws-muted)">Loading what can be shared…</p>;
  if (query.isError) return <p className="text-sm font-semibold text-[#a43c41]">The list could not be loaded.</p>;

  const required = query.data.filter((scope) => REQUIRED_SCOPES.includes(scope.name)).map((scope) => describeScope(scope));
  const optional = query.data.filter((scope) => !REQUIRED_SCOPES.includes(scope.name));
  const selected = new Set(value);

  function toggle(name, checked) {
    const next = new Set(selected);
    if (checked) next.add(name);
    else next.delete(name);
    onChange([...next]);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">Always Included</p>
        {required.map((scope) => (
          <CheckboxField key={scope.name} checked disabled readOnly label={scope.title} description={scope.description} />
        ))}
      </div>
      {groupScopes(optional).map((group) => (
        <div key={group.group} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">{group.group}</p>
          {group.items.map((scope) => (
            <CheckboxField
              key={scope.name}
              checked={selected.has(scope.name)}
              onChange={(event) => toggle(scope.name, event.target.checked)}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {scope.title}
                  {scope.sensitive ? <StatusBadge tone="amber">Sensitive</StatusBadge> : null}
                </span>
              }
              description={scope.description}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
