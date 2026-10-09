import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { buildFixFieldsTooltip } from "../../../lib/form.js";
import { formatStatus } from "../../../lib/format.js";
import { showSuccessToast } from "../../../lib/toast.js";
import { apiClientsApi } from "../api/apiClientsApi.js";
import { groupScopes } from "../utils/scopes.js";
import { usePagedList } from "../hooks/usePagedList.js";
import { ScopeGroupPills } from "./ScopeGroupPills.jsx";

const STATUS_OPTIONS = ["ACTIVE", "DISABLED", "DEPRECATED"].map((value) => ({
  value,
  label: formatStatus(value),
}));

const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function statusTone(status) {
  if (status === "ACTIVE") return "green";
  if (status === "DEPRECATED") return "amber";
  return "red";
}

export function ApplicationProfilesPanel({ profiles, isLoading, dialog, setDialog }) {
  const queryClient = useQueryClient();
  const paged = usePagedList(profiles);

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      id ? apiClientsApi.updateProfile(id, payload) : apiClientsApi.createProfile(payload),
    onSuccess: (_profile, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["application-integration-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["api-clients"] });
      setDialog(null);
      showSuccessToast(id ? "Profile updated." : "Profile created.");
    },
  });

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-(--mws-line) p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef3fb] text-(--mws-navy)">
            <Layers size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
              Application profiles
            </h2>
            <p className="text-xs text-(--mws-muted)">
              A profile is the scope bundle every client of an application gets. Applications get their profile
              when you add them in Application Access.
            </p>
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="px-4 py-3">Application</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Scopes</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Clients</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={7}>
                  Preparing profiles...
                </td>
              </tr>
            ) : profiles.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={7}>
                  No application profiles yet.
                </td>
              </tr>
            ) : (
              paged.pageItems.map((profile) => (
                <tr key={profile.id} className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-(--mws-charcoal)">{profile.name}</p>
                    {profile.application ? (
                      <StatusBadge tone="neutral" className="mt-1">
                        App: {profile.application.name}
                      </StatusBadge>
                    ) : null}
                    <p className="max-w-xs truncate text-xs text-(--mws-muted)">
                      {profile.description || "-"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-(--mws-charcoal)">{profile.code}</code>
                  </td>
                  <td className="px-4 py-3">
                    <ScopeGroupPills scopes={profile.scopes} emptyLabel="No scopes" />
                  </td>
                  <td className="px-4 py-3">{profile.version}</td>
                  <td className="px-4 py-3">{profile.client_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(profile.status)}>
                      {formatStatus(profile.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {profile.application ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/application-access/apps/${profile.application.application_id}/setup`}>
                          Manage in Application Access
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={profile.code === "unmapped"}
                        title={
                          profile.code === "unmapped"
                            ? "Placeholder for legacy clients, not editable"
                            : undefined
                        }
                        onClick={() => setDialog({ mode: "edit", profile })}
                      >
                        <Pencil size={15} />
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        paging={paged.paging}
        itemLabel="profiles"
        isLoading={isLoading}
        onPrevious={paged.onPrevious}
        onNext={paged.onNext}
        onPageSizeChange={paged.onPageSizeChange}
      />

      {dialog ? (
        <ProfileDialog
          dialog={dialog}
          isSubmitting={saveMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            saveMutation.mutate({ id: dialog.profile?.id, payload })
          }
        />
      ) : null}
    </section>
  );
}

function ProfileDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const profile = dialog.profile;
  const isCreate = dialog.mode === "create";
  const [values, setValues] = useState({
    name: profile?.name || "",
    code: profile?.code || "",
    description: profile?.description || "",
    status: profile?.status || "ACTIVE",
    scopeNames: (profile?.scopes || []).map((scope) => scope.name),
  });
  const [codeTouched, setCodeTouched] = useState(false);

  const scopesQuery = useQuery({
    queryKey: ["application-integration-profiles", "scopes"],
    queryFn: apiClientsApi.listProfileScopes,
  });
  const catalog = scopesQuery.data || [];

  const missing = {};
  if (!values.name.trim()) missing.name = "Name is required.";
  if (isCreate && !CODE_PATTERN.test(values.code)) {
    missing.code = "Code must be lowercase letters, numbers, and single hyphens.";
  }
  if (values.scopeNames.length === 0) missing.scopes = "Pick at least one scope.";

  function toggleScope(name, checked) {
    setValues((current) => ({
      ...current,
      scopeNames: checked
        ? [...current.scopeNames, name]
        : current.scopeNames.filter((item) => item !== name),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (Object.keys(missing).length > 0) return;
    const description = values.description.trim();
    onSubmit(
      isCreate
        ? {
            code: values.code,
            name: values.name.trim(),
            description: description || undefined,
            scope_names: values.scopeNames,
          }
        : {
            name: values.name.trim(),
            description: description || null,
            status: values.status,
            scope_names: values.scopeNames,
          },
    );
  }

  return (
    <CrudDialog
      title={isCreate ? "New Application Profile" : "Edit Application Profile"}
      description={
        isCreate
          ? "Every client created from this profile gets exactly these scopes."
          : profile.client_count > 0
            ? `${profile.client_count} client${profile.client_count === 1 ? "" : "s"} use this profile. Changing scopes applies to them immediately.`
            : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="application-profile-form"
            type="submit"
            loading={isSubmitting}
            disabled={Object.keys(missing).length > 0}
            title={buildFixFieldsTooltip(missing)}
          >
            Save
          </Button>
        </>
      }
    >
      <form id="application-profile-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <TextInput
              value={values.name}
              onChange={(event) => {
                const name = event.target.value;
                setValues((current) => ({
                  ...current,
                  name,
                  code: isCreate && !codeTouched ? slugify(name) : current.code,
                }));
              }}
            />
          </Field>
          <Field
            label="Code"
            required={isCreate}
            hint={isCreate ? "Lowercase, used by integrations. Cannot be changed later." : undefined}
          >
            <TextInput
              value={values.code}
              readOnly={!isCreate}
              className={isCreate ? undefined : "bg-(--mws-soft)"}
              onChange={(event) => {
                setCodeTouched(true);
                setValues({ ...values, code: event.target.value.toLowerCase() });
              }}
            />
          </Field>
        </div>
        {!isCreate ? (
          <Field label="Status">
            <SearchableSelect
              value={values.status}
              onChange={(status) => setValues({ ...values, status })}
              options={STATUS_OPTIONS}
              searchableThreshold={99}
            />
          </Field>
        ) : null}
        <Field label="Description">
          <TextAreaInput
            value={values.description}
            onChange={(event) => setValues({ ...values, description: event.target.value })}
          />
        </Field>
        <Field label="Scopes" required>
          {scopesQuery.isLoading ? (
            <p className="text-sm text-(--mws-muted)">Loading scopes...</p>
          ) : (
            <div className="space-y-4">
              {groupScopes(catalog).map(({ group, items }) => (
                <div key={group}>
                  <p className="mb-2 font-display text-xs font-bold text-(--mws-muted)">
                    {group}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((scope) => (
                      <CheckboxField
                        key={scope.name}
                        label={scope.sensitive ? `${scope.title} (sensitive)` : scope.title}
                        description={scope.description || undefined}
                        title={scope.name}
                        checked={values.scopeNames.includes(scope.name)}
                        onChange={(event) => toggleScope(scope.name, event.target.checked)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Field>
      </form>
    </CrudDialog>
  );
}
