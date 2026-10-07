import { ChevronDown, Copy, Play, Server } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { NameList } from "../../../components/ui/NameList.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { usePagedList } from "../hooks/usePagedList.js";
import { describeScope } from "../utils/scopes.js";
import { TryEndpointDialog } from "./TryEndpointDialog.jsx";

const ALL = "";
const COLUMNS = 4;

// What connected MWS apps can ask for, written for people who do not read API paths.
// The method and path sit one click away in Details.
export function InternalApiPanel({ endpoints, profiles = [], isLoading }) {
  const [group, setGroup] = useState(ALL);
  const [app, setApp] = useState(ALL);
  const [open, setOpen] = useState(() => new Set());
  const [trying, setTrying] = useState(null);

  const groups = [...new Set(endpoints.map((endpoint) => endpoint.group).filter(Boolean))];
  // Which applications can use a scope: the ones whose profile includes it.
  const appsOf = (endpoint) =>
    profiles.filter((profile) => (profile.scopes || []).some((scope) => scope.name === endpoint.scope));
  const visible = endpoints.filter(
    (endpoint) =>
      (!group || endpoint.group === group) && (!app || appsOf(endpoint).some((profile) => profile.code === app)),
  );
  const paged = usePagedList(visible);
  // A new filter starts again from the first page.
  const pick = (setter) => (value) => {
    setter(value);
    paged.onPageSizeChange(paged.paging.size);
  };

  function toggleDetails(path) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function copyPath(endpoint) {
    try {
      await navigator.clipboard.writeText(endpoint.path);
      showSuccessToast("Path copied.");
    } catch {
      showErrorToast("Clipboard is blocked in this browser.");
    }
  }

  return (
    <section className="mt-5 min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-(--mws-line) p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-(--mws-navy)">
            <Server size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
              What connected apps can ask for
            </h2>
            <p className="break-words text-xs text-(--mws-muted)">
              Data that MWS apps can request, and the permission each request needs. Give a client a
              profile with that permission.
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <div className="w-full sm:w-56">
            <SearchableSelect
              value={app}
              onChange={pick(setApp)}
              options={[{ value: ALL, label: "All Apps" }, ...profiles.map((profile) => ({ value: profile.code, label: profile.name }))]}
              placeholder="All Apps"
              searchPlaceholder="Search app"
              searchableThreshold={8}
            />
          </div>
          <div className="w-full sm:w-56">
            <SearchableSelect
              value={group}
              onChange={pick(setGroup)}
              options={[{ value: ALL, label: "All Groups" }, ...groups.map((name) => ({ value: name, label: name }))]}
              placeholder="All Groups"
              searchableThreshold={99}
            />
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="px-4 py-3">What It Does</th>
              <th className="px-4 py-3">Needs</th>
              <th className="px-4 py-3">Used By</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={COLUMNS}>
                  Loading endpoints...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={COLUMNS}>
                  No internal endpoints registered.
                </td>
              </tr>
            ) : (
              paged.pageItems.map((endpoint) => {
                const scope = describeScope(endpoint.scope);
                const apps = appsOf(endpoint);
                const expanded = open.has(endpoint.path);
                const name = endpoint.title || endpoint.purpose;
                return (
                  <Fragment key={endpoint.path}>
                    <tr className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-(--mws-charcoal)">{name}</p>
                        {endpoint.title ? (
                          <p className="max-w-md text-xs text-(--mws-muted)">{endpoint.purpose}</p>
                        ) : null}
                        {endpoint.group ? <p className="mt-1 text-[11px] text-(--mws-muted)">{endpoint.group}</p> : null}
                      </td>
                      <td className="px-4 py-3" title={endpoint.scope}>
                        <p className="text-(--mws-charcoal)">{scope.title}</p>
                        {scope.sensitive ? (
                          <StatusBadge tone="red" className="mt-1">
                            Sensitive
                          </StatusBadge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <UsedBy apps={apps} total={profiles.length} scope={scope.title} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`Details of ${name}`}
                            title="Details"
                            onClick={() => toggleDetails(endpoint.path)}
                            className="cursor-pointer rounded-lg p-1.5 text-(--mws-muted) transition-colors hover:text-(--mws-burgundy)"
                          >
                            <ChevronDown size={16} className={`transition-transform ${expanded ? "" : "-rotate-90"}`} />
                          </button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setTrying(endpoint)}>
                            <Play size={14} />
                            Try
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-(--mws-soft)">
                        <td className="px-4 py-3" colSpan={COLUMNS}>
                          <div className="flex min-w-0 items-center gap-2">
                            <StatusBadge tone="green">{endpoint.method}</StatusBadge>
                            <code className="min-w-0 truncate text-xs text-(--mws-charcoal)" title={endpoint.path}>
                              {endpoint.path}
                            </code>
                            <button
                              type="button"
                              aria-label={`Copy path of ${name}`}
                              title="Copy Path"
                              onClick={() => copyPath(endpoint)}
                              className="shrink-0 cursor-pointer rounded-lg p-1 text-(--mws-muted) transition-colors hover:text-(--mws-burgundy)"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        paging={paged.paging}
        itemLabel="endpoints"
        isLoading={isLoading}
        onPrevious={paged.onPrevious}
        onNext={paged.onNext}
        onPageSizeChange={paged.onPageSizeChange}
      />

      {trying ? <TryEndpointDialog endpoint={trying} onClose={() => setTrying(null)} /> : null}
    </section>
  );
}

// Every app, or the apps that use it: a name for one, a count that opens the list for several.
function UsedBy({ apps, total, scope }) {
  if (apps.length === 0) return <span className="text-xs text-(--mws-muted)">No app yet</span>;
  if (total > 1 && apps.length === total) {
    return <span className="text-sm font-semibold text-(--mws-charcoal)">All Apps</span>;
  }
  return <NameList names={apps.map((profile) => profile.name)} noun="apps" title={`Apps that use ${scope}`} />;
}
