import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { ChecklistPicker } from "../../../components/ui/ChecklistPicker.jsx";
import { Field, SearchableSelect, TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { useApplicationPermissions } from "../hooks/useApplicationPermissions.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { AUDIENCES, columnProblems, keyFromLabel, newColumn, requiredBy, togglePermission } from "../utils/bulkRoles.js";
import { cleanLabelInput, labelProblem } from "../utils/roleLabel.js";

const LIST_PAGE = 6;
const AUDIENCE_OPTIONS = AUDIENCES.map((item) => ({ value: item.value, label: item.label }));

export function BulkRolesPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const rolesQuery = useApplicationRoles();
  const permissionsQuery = useApplicationPermissions(applicationId);

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add Roles" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (rolesQuery.isLoading || permissionsQuery.isLoading) return <PanelMessage>Loading…</PanelMessage>;
  if (permissionsQuery.isError) return <PanelMessage tone="error">The permissions of this application could not be loaded.</PanelMessage>;
  const roles = (rolesQuery.data || []).filter((role) => role.application_id === applicationId);
  const options = (permissionsQuery.data?.permissions || []).filter((item) => !item.deprecated).sort((left, right) => left.key.localeCompare(right.key));
  return <Editor applicationId={applicationId} roles={roles} options={options} />;
}

// The new roles are a short list on the left, the permissions of the chosen one are on the right.
function Editor({ applicationId, roles, options }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const back = params.get("from") === "setup" ? `/application-access/apps/${applicationId}/setup` : `/application-access/apps/${applicationId}?tab=roles`;
  const [items, setItems] = useState(() => [newColumn()]);
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [listPage, setListPage] = useState(1);
  const [permissionPage, setPermissionPage] = useState(1);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const closure = requiredBy(options);
  const problems = columnProblems(items, roles, labelProblem, { needsPermission: options.length > 0 });
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const listPages = Math.max(Math.ceil(items.length / LIST_PAGE), 1);
  const currentListPage = Math.min(listPage, listPages);
  const shown = items.slice((currentListPage - 1) * LIST_PAGE, currentListPage * LIST_PAGE);

  const update = (id, patch) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  function addRole() {
    const next = newColumn();
    setItems((current) => [...current, next]);
    setSelectedId(next.id);
    setListPage(Math.ceil((items.length + 1) / LIST_PAGE));
    setPermissionPage(1);
    setSearch("");
  }

  function removeRole(id) {
    const rest = items.filter((item) => item.id !== id);
    setItems(rest);
    if (id === selectedId) setSelectedId(rest[0].id);
  }

  function select(id) {
    setSelectedId(id);
    setPermissionPage(1);
    setSearch("");
  }

  const needle = search.trim().toLowerCase();
  const visible = options.filter((option) => !needle || option.key.toLowerCase().includes(needle) || (option.description || "").toLowerCase().includes(needle));
  const checklist = visible.map((option) => ({ id: option.key, label: option.key, sublabel: option.description || undefined, labelClassName: "font-mono text-xs text-(--mws-burgundy)" }));

  function toggleAll(checked) {
    const keys = visible.map((option) => option.key);
    const next = checked ? [...new Set([...selected.permissions, ...keys])] : selected.permissions.filter((key) => !keys.includes(key));
    // What a ticked permission needs stays ticked.
    update(selected.id, { permissions: [...new Set([...next, ...next.flatMap((key) => [...closure(key)])])] });
  }

  const copyOptions = [
    ...items.filter((item) => item.id !== selected.id && item.permissions.length > 0).map((item) => ({ value: item.id, label: item.label.trim() || "Untitled role" })),
    ...roles.filter((role) => role.is_active).map((role) => ({ value: `existing:${role.id}`, label: role.key })),
  ];
  function copyFrom(value) {
    const source = value.startsWith("existing:") ? roles.find((role) => role.id === value.slice(9)) : items.find((item) => item.id === value);
    if (source) update(selected.id, { permissions: [...source.permissions] });
  }

  async function save() {
    setAttempted(true);
    if (Object.keys(problems).length > 0) {
      const first = items.find((item) => problems[item.id]);
      if (first) select(first.id);
      return;
    }
    setSaving(true);
    const failed = {};
    const left = [];
    let added = 0;
    for (const item of items) {
      const audience = AUDIENCES.find((entry) => entry.value === item.audience);
      try {
        await applicationAccessApi.createRole({
          application_id: applicationId,
          key: keyFromLabel(item.label),
          label: item.label.trim(),
          permissions: item.permissions,
          allows_employees: audience.allows_employees,
          allows_students: audience.allows_students,
        });
        added += 1;
      } catch (error) {
        failed[item.id] = error instanceof Error ? error.message : "Could not add this role.";
        left.push(item);
      }
    }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["application-access"] });
    if (added > 0) showSuccessToast(added === 1 ? "Role added." : `${added} roles added.`);
    if (left.length === 0) {
      navigate(back);
      return;
    }
    setItems(left);
    setSelectedId(left[0].id);
    setListPage(1);
    setErrors(failed);
    showErrorToast(new Error("Some roles could not be added."), "Some roles could not be added.");
  }

  const problem = problems[selected.id];
  const nameError = attempted || selected.label ? problem?.name : undefined;
  const incomplete = items.filter((item) => problems[item.id] || !item.label.trim()).length;

  return (
    <div className="min-w-0">
      <PageHeader
        title={`Add Roles to ${applicationId}`}
        description="Add the roles, then pick what each may do. They are saved together."
        actions={
          <Button asChild variant="secondary">
            <Link to={back}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section aria-label="Roles" className="min-w-0 self-start rounded-2xl border border-(--mws-line) bg-white">
          <h2 className="border-b border-(--mws-line) px-4 py-3 font-display text-sm font-bold text-(--mws-charcoal)">Roles</h2>
          <ul className="divide-y divide-(--mws-line)">
            {shown.map((item) => {
              const bad = (attempted || item.label) && problems[item.id];
              return (
                <li key={item.id} className={`flex items-center gap-2 px-4 py-2.5 ${item.id === selected.id ? "bg-(--mws-soft)" : ""}`}>
                  <button type="button" aria-current={item.id === selected.id} onClick={() => select(item.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <span className={`block truncate text-sm font-semibold ${item.label ? "text-(--mws-charcoal)" : "text-(--mws-muted)"}`}>{item.label || "Untitled role"}</span>
                    <span className="block truncate text-xs text-(--mws-muted)">
                      {AUDIENCES.find((entry) => entry.value === item.audience)?.label}, {item.permissions.length} permission{item.permissions.length === 1 ? "" : "s"}
                      {bad || errors[item.id] ? <span className="text-[#a43c41]"> · Needs a look</span> : null}
                    </span>
                  </button>
                  {items.length > 1 ? (
                    <button type="button" aria-label={`Remove ${item.label || "untitled role"}`} onClick={() => removeRole(item.id)} className="cursor-pointer text-(--mws-muted) hover:text-(--mws-rose)">
                      <X size={15} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-(--mws-line) px-4 py-2.5">
            <TextAction onClick={addRole}>Add Another Role</TextAction>
            {listPages > 1 ? (
              <span className="flex items-center gap-1 text-xs text-(--mws-muted)">
                <button type="button" aria-label="Previous roles" disabled={currentListPage <= 1} onClick={() => setListPage(currentListPage - 1)} className="cursor-pointer disabled:opacity-40">
                  <ChevronLeft size={15} />
                </button>
                {currentListPage} / {listPages}
                <button type="button" aria-label="Next roles" disabled={currentListPage >= listPages} onClick={() => setListPage(currentListPage + 1)} className="cursor-pointer disabled:opacity-40">
                  <ChevronRight size={15} />
                </button>
              </span>
            ) : null}
          </div>
        </section>

        <section aria-label="Role details" className="min-w-0 space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={nameError}>
              <TextInput aria-label="Role name" value={selected.label} maxLength={64} placeholder="Role name" invalid={Boolean(nameError)} onChange={(event) => update(selected.id, { label: cleanLabelInput(event.target.value) })} />
              <p className="mt-1 font-mono text-[11px] text-(--mws-muted)">{keyFromLabel(selected.label) || "KEY"}</p>
            </Field>
            <Field label="For">
              <SearchableSelect value={selected.audience} onChange={(value) => update(selected.id, { audience: value || "employees" })} options={AUDIENCE_OPTIONS} placeholder="Select who it is for" />
            </Field>
          </div>
          {copyOptions.length > 0 ? (
            <Field label="Copy Permissions From" hint="Start from the permissions of another role, then change them.">
              <SearchableSelect value="" onChange={copyFrom} options={copyOptions} placeholder="Select a role" searchPlaceholder="Search role" />
            </Field>
          ) : null}
          {problem?.permissions && selected.label ? <p className="text-sm font-semibold text-[#a43c41]">{problem.permissions}</p> : null}
          {problem?.twin ? <p className="text-sm font-semibold text-[#a43c41]">{problem.twin} already has exactly these permissions. Change them.</p> : null}
          {errors[selected.id] ? <p className="text-sm font-semibold text-[#a43c41]">{errors[selected.id]}</p> : null}
          {options.length === 0 ? (
            <PanelMessage>This application has not sent its permissions yet.</PanelMessage>
          ) : (
            <div className="space-y-2">
              {options.length > 12 ? (
                <TextInput
                  aria-label="Search permissions"
                  value={search}
                  placeholder="Search permissions"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPermissionPage(1);
                  }}
                />
              ) : null}
              <ChecklistPicker
                items={checklist}
                selectedIds={selected.permissions}
                onToggle={(key) => update(selected.id, { permissions: togglePermission(selected.permissions, key, closure) })}
                onToggleAll={toggleAll}
                page={permissionPage}
                onPageChange={setPermissionPage}
                pageSize={10}
                itemLabel="permission"
                emptyMessage="No permission matches."
              />
            </div>
          )}
        </section>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {incomplete > 0 ? <p className="mr-auto text-xs text-(--mws-muted)">{`${incomplete} ${incomplete === 1 ? "role is" : "roles are"} not complete`}</p> : null}
        <Button asChild variant="secondary">
          <Link to={back}>Cancel</Link>
        </Button>
        <Button type="button" loading={saving} disabled={incomplete > 0} onClick={save}>
          {items.length === 1 ? "Add Role" : `Add ${items.length} Roles`}
        </Button>
      </div>
    </div>
  );
}
