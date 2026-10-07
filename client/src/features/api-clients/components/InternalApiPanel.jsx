import { Copy, Play, Server } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { NameList } from "../../../components/ui/NameList.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { usePagedList } from "../hooks/usePagedList.js";
import { describeScope } from "../utils/scopes.js";
import { TryEndpointDialog } from "./TryEndpointDialog.jsx";

const ALL_GROUPS = "";
const ALL_APPS = "";

// What connected MWS apps can ask for, written for people who do not read
// API paths. The technical path stays visible in a muted column.
export function InternalApiPanel({ endpoints, profiles = [], isLoading }) {
  const [group, setGroup] = useState(ALL_GROUPS);
  const [app, setApp] = useState(ALL_APPS);
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
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef3fb] text-(--mws-navy)">
            <Server size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
              What connected apps can ask for
            </h2>
            <p className="break-words text-xs text-(--mws-muted)">
              Data that MWS apps such as Daily Check-in, Hub, and Exima can request, and the
              permission each request needs. Give a client a profile with that permission.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <div className="w-full sm:w-52">
            <SearchableSelect
              value={app}
              onChange={(next) => {
                setApp(next);
                paged.onPageSizeChange(paged.paging.size);
              }}
              options={[
                { value: ALL_APPS, label: "All Apps" },
                ...profiles.map((profile) => ({ value: profile.code, label: profile.name })),
              ]}
              placeholder="All Apps"
              searchableThreshold={99}
            />
          </div>
          <div className="w-full sm:w-52">
          <SearchableSelect
            value={group}
            onChange={(next) => {
              setGroup(next);
              paged.onPageSizeChange(paged.paging.size);
            }}
            options={[
              { value: ALL_GROUPS, label: "All Groups" },
              ...groups.map((name) => ({ value: name, label: name })),
            ]}
            placeholder="All Groups"
            searchableThreshold={99}
          />
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="px-4 py-3">What It Does</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Permission Needed</th>
              <th className="px-4 py-3">Used By</th>
              <th className="px-4 py-3">Technical</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={6}>
                  Loading endpoints...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={6}>
                  No internal endpoints registered.
                </td>
              </tr>
            ) : (
              paged.pageItems.map((endpoint) => {
                const scope = describeScope(endpoint.scope);
                return (
                  <tr key={endpoint.path} className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {endpoint.title || endpoint.purpose}
                      </p>
                      {endpoint.title ? (
                        <p className="max-w-md text-xs text-(--mws-muted)">{endpoint.purpose}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-(--mws-charcoal)">{endpoint.group || "-"}</td>
                    <td className="px-4 py-3" title={endpoint.scope}>
                      <p className="text-(--mws-charcoal)">{scope.title}</p>
                      {scope.sensitive ? (
                        <StatusBadge tone="red" className="mt-1">Sensitive</StatusBadge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <UsedBy apps={appsOf(endpoint)} total={profiles.length} scope={scope.title} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 max-w-xs items-center gap-2">
                        <StatusBadge tone="green">{endpoint.method}</StatusBadge>
                        <code
                          className="truncate text-xs text-(--mws-muted)"
                          title={endpoint.path}
                        >
                          {endpoint.path}
                        </code>
                        <button
                          type="button"
                          aria-label={`Copy path of ${endpoint.title || endpoint.path}`}
                          title="Copy Path"
                          onClick={() => copyPath(endpoint)}
                          className="shrink-0 cursor-pointer rounded-lg p-1 text-(--mws-muted) transition-colors hover:text-(--mws-burgundy)"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setTrying(endpoint)}>
                        <Play size={14} />
                        Try
                      </Button>
                    </td>
                  </tr>
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

// Every app, the one app that uses it, or a count that opens the list.
function UsedBy({ apps, total, scope }) {
  if (apps.length === 0) return <span className="text-xs text-(--mws-muted)">No app yet</span>;
  if (total > 1 && apps.length === total) {
    return <span className="text-sm font-semibold text-(--mws-charcoal)">All Apps</span>;
  }
  return (
    <div className="space-y-0.5">
      <NameList
        names={apps.map((profile) => profile.name)}
        noun="apps"
        title={`Apps that use ${scope}`}
      />
      {apps.length === 1 ? <p className="text-xs text-(--mws-muted)">Only this app</p> : null}
    </div>
  );
}
