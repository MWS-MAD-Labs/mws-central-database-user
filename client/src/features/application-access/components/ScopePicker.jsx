import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { CheckboxField } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { apiClientsApi } from "../../api-clients/api/apiClientsApi.js";
import { useInternalEndpoints, pathOnly } from "../hooks/useInternalEndpoints.js";
import { REQUIRED_SCOPES } from "../utils/connectionScopes.js";
import { describeScope, groupScopes } from "../../api-clients/utils/scopes.js";

// The endpoints a scope opens, closed until asked for so the list stays short.
function ScopeEndpoints({ endpoints, open, onToggle }) {
  const count = endpoints.length;
  return (
    <div className="mt-1.5 pb-1 pl-10 pr-3 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="inline-flex cursor-pointer items-center gap-1 font-medium text-(--mws-burgundy) hover:underline"
      >
        {count === 0 ? "No endpoint uses this scope yet" : `${count} endpoint${count === 1 ? "" : "s"}`}
        {count > 0 ? <ChevronDown size={12} className={open ? "rotate-180" : undefined} aria-hidden="true" /> : null}
      </button>
      {open && count > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {endpoints.map((endpoint) => (
            <li key={`${endpoint.method} ${endpoint.path}`} className="flex flex-wrap items-baseline gap-x-2 text-(--mws-muted)">
              <code className="font-mono text-[11px] text-(--mws-charcoal)">
                {endpoint.method} {pathOnly(endpoint.path)}
              </code>
              <span>{endpoint.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// What the application may read from Central. The two required scopes are shown but cannot be turned off.
export function ScopePicker({ value, onChange }) {
  const { byScope, loaded } = useInternalEndpoints();
  const [openScopes, setOpenScopes] = useState(() => new Set());
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
  const toggleOpen = (name) =>
    setOpenScopes((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Left out when the list could not be loaded, the choice itself does not depend on it.
  const endpointsOf = (name) =>
    loaded ? (
      <ScopeEndpoints endpoints={byScope.get(name) ?? []} open={openScopes.has(name)} onToggle={() => toggleOpen(name)} />
    ) : null;

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
          <div key={scope.name}>
            <CheckboxField checked disabled readOnly label={scope.title} description={scope.description} />
            {endpointsOf(scope.name)}
          </div>
        ))}
      </div>
      {groupScopes(optional).map((group) => (
        <div key={group.group} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">{group.group}</p>
          {group.items.map((scope) => (
            <div key={scope.name}>
            <CheckboxField
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
            {endpointsOf(scope.name)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
