import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { useApplicationPermissions } from "../hooks/useApplicationPermissions.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { AUDIENCES, columnProblems, keyFromLabel, matrixAreas, newColumn, requiredBy, togglePermission } from "../utils/bulkRoles.js";
import { cleanLabelInput, labelProblem } from "../utils/roleLabel.js";

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

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
  const options = (permissionsQuery.data?.permissions || []).filter((item) => !item.deprecated);
  return <Matrix applicationId={applicationId} roles={roles} options={options} />;
}

function Matrix({ applicationId, roles, options }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const back = params.get("from") === "setup" ? `/application-access/apps/${applicationId}/setup` : `/application-access/apps/${applicationId}?tab=roles`;
  const [columns, setColumns] = useState(() => [newColumn()]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const closure = requiredBy(options);
  const areas = matrixAreas(options);
  const problems = columnProblems(columns, roles, labelProblem);

  const update = (id, patch) => setColumns((current) => current.map((column) => (column.id === id ? { ...column, ...patch } : column)));
  const allTicked = (column) => options.length > 0 && options.every((option) => column.permissions.includes(option.key));

  async function save() {
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    const failed = {};
    const left = [];
    let added = 0;
    for (const column of columns) {
      const audience = AUDIENCES.find((item) => item.value === column.audience);
      try {
        await applicationAccessApi.createRole({
          application_id: applicationId,
          key: keyFromLabel(column.label),
          label: column.label.trim(),
          permissions: column.permissions,
          allows_employees: audience.allows_employees,
          allows_students: audience.allows_students,
        });
        added += 1;
      } catch (error) {
        failed[column.id] = error instanceof Error ? error.message : "Could not add this role.";
        left.push(column);
      }
    }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["application-access"] });
    if (added > 0) showSuccessToast(added === 1 ? "Role added." : `${added} roles added.`);
    if (left.length === 0) {
      navigate(back);
      return;
    }
    setColumns(left);
    setErrors(failed);
    showErrorToast(new Error("Some roles could not be added."), "Some roles could not be added.");
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={`Add Roles to ${applicationId}`}
        description="One column for each role. Name it, pick who it is for, and tick what it may do. All of them are saved together."
        actions={
          <Button asChild variant="secondary">
            <Link to={back}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <div className="mws-scrollbar overflow-x-auto rounded-2xl border border-(--mws-line) bg-white">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="align-bottom">
              <th scope="col" className="sticky left-0 z-10 min-w-64 bg-white p-3 text-left text-xs font-bold uppercase tracking-wide text-(--mws-muted)">
                Permission
              </th>
              {columns.map((column, index) => {
                const problem = problems[column.id];
                const shownName = attempted || column.label ? problem?.name : undefined;
                return (
                  <th key={column.id} scope="col" className="min-w-44 border-l border-(--mws-line) p-3 text-left align-top font-normal">
                    <div className="space-y-2">
                      <div className="flex items-start gap-1.5">
                        <TextInput
                          aria-label={`Role ${index + 1} name`}
                          value={column.label}
                          maxLength={64}
                          placeholder="Role name"
                          invalid={Boolean(shownName)}
                          onChange={(event) => update(column.id, { label: cleanLabelInput(event.target.value) })}
                        />
                        {columns.length > 1 ? (
                          <button
                            type="button"
                            aria-label={`Remove role ${index + 1}`}
                            onClick={() => setColumns((current) => current.filter((item) => item.id !== column.id))}
                            className="mt-2 cursor-pointer text-(--mws-muted) hover:text-(--mws-rose)"
                          >
                            <X size={16} />
                          </button>
                        ) : null}
                      </div>
                      <p className="font-mono text-[11px] text-(--mws-muted)">{keyFromLabel(column.label) || "KEY"}</p>
                      <select
                        aria-label={`Role ${index + 1} is for`}
                        value={column.audience}
                        onChange={(event) => update(column.id, { audience: event.target.value })}
                        className="h-8 w-full rounded-lg border border-(--mws-line) bg-white px-2 text-xs"
                      >
                        {AUDIENCES.map((item) => (
                          <option key={item.value} value={item.value}>
                            For {item.label.toLowerCase()}
                          </option>
                        ))}
                      </select>
                      {shownName ? <p className="text-xs text-[#a43c41]">{shownName}</p> : null}
                      {problem?.twin ? <p className="text-xs text-[#a43c41]">{problem.twin} already has exactly these permissions. Change them.</p> : null}
                      {errors[column.id] ? <p className="text-xs font-semibold text-[#a43c41]">{errors[column.id]}</p> : null}
                    </div>
                  </th>
                );
              })}
              <td className="border-l border-(--mws-line) p-3 align-top">
                <Button type="button" variant="secondary" size="sm" onClick={() => setColumns((current) => [...current, newColumn()])}>
                  <Plus size={14} />
                  Add Another Role
                </Button>
              </td>
            </tr>
            <tr className="border-t border-(--mws-line) bg-(--mws-soft)">
              <th scope="row" className="sticky left-0 z-10 bg-(--mws-soft) p-3 text-left text-xs font-bold text-(--mws-charcoal)">
                All Permissions
              </th>
              {columns.map((column, index) => (
                <td key={column.id} className="border-l border-(--mws-line) p-3">
                  <input
                    type="checkbox"
                    aria-label={`Role ${index + 1} all permissions`}
                    checked={allTicked(column)}
                    onChange={(event) => update(column.id, { permissions: event.target.checked ? options.map((option) => option.key) : [] })}
                    className="h-4 w-4 cursor-pointer accent-(--mws-burgundy)"
                  />
                </td>
              ))}
              <td className="border-l border-(--mws-line)" />
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <AreaRows key={area.area} area={area} columns={columns} closure={closure} update={update} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-(--mws-muted)">
          A permission that needs another one ticks it too. {options.length === 0 ? "This application has not sent its permissions yet." : ""}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link to={back}>Cancel</Link>
          </Button>
          <Button type="button" loading={saving} disabled={columns.some((column) => !column.label.trim())} onClick={save}>
            {columns.length === 1 ? "Add Role" : `Add ${columns.length} Roles`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AreaRows({ area, columns, closure, update }) {
  return (
    <>
      <tr className="border-t border-(--mws-line) bg-(--mws-soft)/60">
        <th scope="rowgroup" colSpan={columns.length + 2} className="sticky left-0 p-2 pl-3 text-left text-xs font-bold uppercase tracking-wide text-(--mws-muted)">
          {capital(area.area)}
        </th>
      </tr>
      {area.rows.map((row) => (
        <tr key={row.key} className="border-t border-(--mws-line)">
          <th scope="row" className="sticky left-0 z-10 bg-white p-3 text-left font-normal">
            <span className="block font-mono text-xs font-semibold text-(--mws-burgundy)">{row.key}</span>
            {row.description ? <span className="block text-[11px] leading-4 text-(--mws-muted)">{row.description}</span> : null}
          </th>
          {columns.map((column, index) => {
            const needed = column.permissions.some((item) => item !== row.key && closure(item).has(row.key)) && column.permissions.includes(row.key);
            return (
              <td key={column.id} className="border-l border-(--mws-line) p-3">
                <input
                  type="checkbox"
                  aria-label={`Role ${index + 1} ${row.key}`}
                  checked={column.permissions.includes(row.key)}
                  disabled={needed}
                  title={needed ? "Another ticked permission needs this one" : undefined}
                  onChange={() => update(column.id, { permissions: togglePermission(column.permissions, row.key, closure) })}
                  className="h-4 w-4 cursor-pointer accent-(--mws-burgundy) disabled:cursor-not-allowed"
                />
              </td>
            );
          })}
          <td className="border-l border-(--mws-line)" />
        </tr>
      ))}
    </>
  );
}
