import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
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
import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { cleanPayload, trimmedOrUndefined } from "../../../lib/form.js";
import { formatDateTime, formatStatus } from "../../../lib/format.js";
import { isPendingFor } from "../../../lib/mutationState.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { apiClientsApi } from "../api/apiClientsApi.js";
import { InternalApiPanel } from "../components/InternalApiPanel.jsx";
import { ApplicationProfilesPanel } from "../components/ApplicationProfilesPanel.jsx";
import { TokenDialog } from "../components/TokenDialog.jsx";
import { ScopeGroupList, ScopeGroupPills } from "../components/ScopeGroupPills.jsx";
import { usePagedList } from "../hooks/usePagedList.js";
import { PURPOSE_LABELS, scopeName } from "../utils/scopes.js";

export function ApiClientsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "profiles" ? "profiles" : "clients";
  const [profileDialog, setProfileDialog] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenDialog, setTokenDialog] = useState(null);
  const [scopesDialogFor, setScopesDialogFor] = useState(null);
  const [rotateDialogFor, setRotateDialogFor] = useState(null);
  const [highlightClientId, setHighlightClientId] = useState(null);

  const clientsQuery = useQuery({
    queryKey: ["api-clients"],
    queryFn: apiClientsApi.list,
  });

  const profilesQuery = useQuery({
    queryKey: ["application-integration-profiles"],
    queryFn: apiClientsApi.listProfiles,
  });

  const internalEndpointsQuery = useQuery({
    queryKey: ["api-clients", "internal-endpoints"],
    queryFn: apiClientsApi.listInternalEndpoints,
  });
  const internalEndpoints = internalEndpointsQuery.data || [];
  const scopeNames = [...new Set(internalEndpoints.map((endpoint) => endpoint.scope))];

  const createMutation = useMutation({
    mutationFn: apiClientsApi.create,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["api-clients"] });
      setCreateOpen(false);
      setTokenDialog({ title: "Client Token", client });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: apiClientsApi.rotate,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["api-clients"] });
      setRotateDialogFor(null);
      setTokenDialog({ title: "Rotated Credentials", client });
    },
  });

  const revokeMutation = useMutation({
    meta: { successMessage: "API client revoked." },
    mutationFn: apiClientsApi.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-clients"] });
    },
  });

  const updateScopesMutation = useMutation({
    mutationFn: ({ id, scopeNames }) => apiClientsApi.updateScopes(id, scopeNames),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-clients"] });
      setScopesDialogFor(null);
      showSuccessToast("Scopes updated.");
    },
  });

  const revokeCredentialMutation = useMutation({
    mutationFn: ({ clientId, credentialId }) =>
      apiClientsApi.revokeCredential(clientId, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-clients"] });
      showSuccessToast("Credential revoked.");
    },
  });

  async function handleRevokeCredential(client, credential) {
    if (await confirm({
      title: "Revoke Credential",
      description: `Credential ${credential.token_prefix} will stop working immediately.`,
      confirmLabel: "Revoke Credential",
      tone: "danger",
    })) {
      revokeCredentialMutation.mutate({
        clientId: client.id,
        credentialId: credential.id,
      });
    }
  }

  async function handleRevoke(client) {
    if (
      await confirm({
        title: "Revoke API Client",
        description: `"${client.name}" will be revoked.`,
        confirmLabel: "Revoke",
        tone: "danger",
      })
    ) {
      revokeMutation.mutate(client.id);
    }
  }

  async function handleRotate(options) {
    const emergency = options.mode === "emergency";
    const confirmed = await confirm({
      title: emergency ? "Emergency Token Rotation" : "Rotate API Client Token",
      description: emergency
        ? "The current credential will stop working immediately. Confirm that the replacement can be deployed now."
        : "A new credential will be issued and the current credential will remain valid for 24 hours.",
      confirmLabel: emergency ? "Rotate Immediately" : "Start Rotation",
      tone: emergency ? "danger" : undefined,
    });
    if (confirmed) rotateMutation.mutate({ id: rotateDialogFor.id, ...options });
  }

  function showExistingClient(client) {
    setCreateOpen(false);
    setHighlightClientId(client.id);
    window.setTimeout(() => setHighlightClientId(null), 2500);
    window.requestAnimationFrame(() => {
      document.getElementById(`api-client-${client.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  const clients = clientsQuery.data || [];
  const clientPaging = usePagedList(clients);
  const profiles = profilesQuery.data?.profiles || [];
  const serverEnvironment =
    profilesQuery.data?.environment ||
    clients.find((client) => client.environment)?.environment ||
    "Server Managed";

  return (
    <div className="min-w-0">
      <PageHeader
        title="API Clients"
        description="Create and manage scoped access for internal MWS applications."
        actions={
          activeTab === "profiles" ? (
            <Button type="button" onClick={() => setProfileDialog({ mode: "create" })}>
              <Plus size={16} />
              New Profile
            </Button>
          ) : (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              New Client
            </Button>
          )
        }
      />

      <div className="mb-5 flex gap-1 border-b border-(--mws-line)" role="tablist">
        {[
          { id: "clients", label: "Clients" },
          { id: "profiles", label: "Application Profiles" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setSearchParams(tab.id === "clients" ? {} : { tab: tab.id })}
            className={`-mb-px border-b-2 px-4 py-2.5 font-display text-sm font-bold transition ${
              activeTab === tab.id
                ? "border-(--mws-burgundy) text-(--mws-burgundy)"
                : "border-transparent text-(--mws-muted) hover:text-(--mws-charcoal)"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profiles" ? (
        <ApplicationProfilesPanel
          profiles={profiles}
          isLoading={profilesQuery.isLoading}
          dialog={profileDialog}
          setDialog={setProfileDialog}
        />
      ) : (
        <>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 flex-col gap-3 border-b border-(--mws-line) p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
              <KeyRound size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
                Token management
              </h2>
              <LiveIndicator isSyncing={clientsQuery.isFetching} />
            </div>
          </div>
        </div>

        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
              <tr>
                <th className="px-4 py-3">Application</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Credential</th>
                <th className="px-4 py-3">Last Used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clientsQuery.isLoading ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-(--mws-muted)"
                    colSpan={6}
                  >
                    Preparing API clients...
                  </td>
                </tr>
              ) : (clientsQuery.data || []).length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-(--mws-muted)"
                    colSpan={6}
                  >
                    No API clients are ready to review.
                  </td>
                </tr>
              ) : (
                clientPaging.pageItems.map((client) => (
                  <tr
                    key={client.id}
                    id={`api-client-${client.id}`}
                    className={`border-t border-(--mws-line) transition hover:bg-(--mws-soft) ${highlightClientId === client.id ? "bg-[#fff4d8] ring-2 ring-inset ring-[#c59b3b]" : "bg-white"}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {client.profile?.name || client.application || client.name}
                        {!client.profile ? (
                          <StatusBadge tone="amber" className="ml-2 align-middle">Legacy</StatusBadge>
                        ) : null}
                      </p>
                      <p className="max-w-xs truncate text-xs text-(--mws-muted)">
                        {client.description || "-"}
                      </p>
                      <p className="mt-0.5 text-xs text-(--mws-muted)">
                        {[
                          formatEnvironment(client.environment || serverEnvironment),
                          client.purpose
                            ? PURPOSE_LABELS[client.purpose] || formatLabel(client.purpose)
                            : null,
                          client.profile?.version ?? client.profile_version
                            ? `v${client.profile?.version ?? client.profile_version}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="px-4 py-3"><ScopeGroupPills scopes={getEffectiveScopes(client)} /></td>
                    <td className="px-4 py-3">
                      <CredentialSummary client={client} />
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(client.last_used_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={clientIsActive(client) ? "green" : "red"}>
                        {formatStatus(client.status || (client.is_active ? "ACTIVE" : "REVOKED"))}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ClientActionsMenu
                        client={client}
                        onRotate={() => setRotateDialogFor(client)}
                        onEditScopes={() => setScopesDialogFor(client)}
                        onRevokeCredential={(credential) => handleRevokeCredential(client, credential)}
                        onRevoke={() => handleRevoke(client)}
                        isBusy={
                          isPendingFor(rotateMutation, (variables) => variables?.id === client.id) ||
                          isPendingFor(revokeMutation, client.id)
                        }
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          paging={clientPaging.paging}
          itemLabel="clients"
          isLoading={clientsQuery.isLoading}
          onPrevious={clientPaging.onPrevious}
          onNext={clientPaging.onNext}
          onPageSizeChange={clientPaging.onPageSizeChange}
        />
      </section>

      <InternalApiPanel
        endpoints={internalEndpoints}
        profiles={profiles}
        isLoading={internalEndpointsQuery.isLoading}
      />
        </>
      )}

      {createOpen ? (
        <ApiClientDialog
          profiles={profiles}
          clients={clients}
          environment={serverEnvironment}
          isLoading={profilesQuery.isLoading}
          isSubmitting={createMutation.isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(payload) => createMutation.mutate(payload)}
          onShowExisting={showExistingClient}
        />
      ) : null}

      {rotateDialogFor ? (
        <RotateClientDialog
          client={rotateDialogFor}
          isSubmitting={rotateMutation.isPending}
          onClose={() => setRotateDialogFor(null)}
          onSubmit={handleRotate}
        />
      ) : null}

      {tokenDialog ? (
        <TokenDialog
          title={tokenDialog.title}
          client={tokenDialog.client}
          onClose={() => setTokenDialog(null)}
        />
      ) : null}

      {scopesDialogFor ? (
        <EditScopesDialog
          client={scopesDialogFor}
          scopeNames={scopeNames}
          isSubmitting={updateScopesMutation.isPending}
          onClose={() => setScopesDialogFor(null)}
          onSubmit={(scopeNames) =>
            updateScopesMutation.mutate({ id: scopesDialogFor.id, scopeNames })
          }
        />
      ) : null}
    </div>
  );
}

const PURPOSES = ["backend", "roster-sync", "report-export", "ci", "other"];

function ApiClientDialog({
  profiles,
  clients,
  environment,
  isLoading,
  isSubmitting,
  onClose,
  onSubmit,
  onShowExisting,
}) {
  const [values, setValues] = useState({
    profileId: "",
    purpose: "backend",
    description: "",
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const selectedProfile = profiles.find((profile) => profile.id === values.profileId);
  const existingClient = clients.find(
    (client) =>
      client.profile &&
      (client.profile.id === selectedProfile?.id ||
        client.profile.code === selectedProfile?.code) &&
      normalizeValue(client.environment) === normalizeValue(environment) &&
      normalizeValue(client.purpose) === normalizeValue(values.purpose) &&
      clientIsActive(client),
  );
  const profileError =
    hasAttemptedSubmit && !selectedProfile
      ? "Application profile is required."
      : undefined;

  function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (!selectedProfile || existingClient) return;
    onSubmit(
      cleanPayload({
        profile_id: selectedProfile.id,
        description: trimmedOrUndefined(values.description),
        purpose: values.purpose,
      }),
    );
  }

  return (
    <CrudDialog
      title="New API Client"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="api-client-form"
            type="submit"
            loading={isSubmitting}
            disabled={Boolean(existingClient) || isLoading || !selectedProfile}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="api-client-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Application Profile" error={profileError}>
          <SearchableSelect
            required={hasAttemptedSubmit}
            value={values.profileId}
            onChange={(profileId) => setValues({ ...values, profileId })}
            placeholder={isLoading ? "Loading profiles..." : "Select a profile"}
            searchPlaceholder="Search profiles"
            options={profiles.map((profile) => ({
              value: profile.id,
              label: profile.name,
              description: profile.code,
              badge:
                profile.status && profile.status !== "ACTIVE"
                  ? formatStatus(profile.status)
                  : undefined,
              searchText: `${profile.name} ${profile.code}`,
              disabled: Boolean(profile.status && profile.status !== "ACTIVE"),
            }))}
          />
        </Field>
        {selectedProfile?.description ? (
          <p className="rounded-xl bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
            {selectedProfile.description}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Server Environment">
            <TextInput readOnly value={formatEnvironment(environment)} className="bg-(--mws-soft)" />
          </Field>
          <Field
            label="Purpose"
            hint="Only a label. One client per profile, environment, and purpose."
          >
            <SearchableSelect
              value={values.purpose}
              onChange={(purpose) => setValues({ ...values, purpose })}
              options={PURPOSES.map((purpose) => ({
                value: purpose,
                label: PURPOSE_LABELS[purpose] || formatLabel(purpose),
              }))}
              searchableThreshold={99}
            />
          </Field>
        </div>
        <Field label="Description">
          <TextAreaInput
            value={values.description}
            onChange={(event) =>
              setValues({ ...values, description: event.target.value })
            }
          />
        </Field>
        <div>
          <p className="mb-2 font-display text-sm font-bold text-(--mws-charcoal)">Automatic Scopes</p>
          <ScopeGroupList scopes={selectedProfile?.scopes || []} emptyLabel="Select a profile to preview its managed scopes." />
        </div>
        {existingClient ? (
          <div className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3 text-sm text-[#745716]">
            <p className="font-semibold">This profile, environment, and purpose already has a client.</p>
            <button type="button" className="mt-1 font-semibold underline" onClick={() => onShowExisting(existingClient)}>
              View existing client
            </button>
          </div>
        ) : null}
      </form>
    </CrudDialog>
  );
}

function RotateClientDialog({ client, isSubmitting, onClose, onSubmit }) {
  const [mode, setMode] = useState("graceful");

  return (
    <CrudDialog
      title="Rotate Credentials"
      description={client.profile?.name || client.name}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant={mode === "emergency" ? "danger" : "primary"}
            loading={isSubmitting}
            onClick={() => onSubmit({ mode, graceSeconds: mode === "graceful" ? 86400 : 0 })}
          >
            Rotate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className={`block cursor-pointer rounded-xl border p-4 ${mode === "graceful" ? "border-(--mws-burgundy) bg-[#7E15180D]" : "border-(--mws-line)"}`}>
          <span className="flex items-start gap-3">
            <input type="radio" name="rotation-mode" value="graceful" checked={mode === "graceful"} onChange={() => setMode("graceful")} className="mt-1" />
            <span><strong className="block text-(--mws-charcoal)">Graceful Rotation (Recommended)</strong><span className="text-sm text-(--mws-muted)">Keep the current credential valid for 24 hours while the new credential is deployed.</span></span>
          </span>
        </label>
        <label className={`block cursor-pointer rounded-xl border p-4 ${mode === "emergency" ? "border-[#c75f64] bg-[#fff0f1]" : "border-(--mws-line)"}`}>
          <span className="flex items-start gap-3">
            <input type="radio" name="rotation-mode" value="emergency" checked={mode === "emergency"} onChange={() => setMode("emergency")} className="mt-1" />
            <span><strong className="flex items-center gap-2 text-[#a43c41]"><AlertTriangle size={16} />Emergency Immediate</strong><span className="text-sm text-(--mws-muted)">Revoke the current credential as soon as the new one is issued.</span></span>
          </span>
        </label>
      </div>
    </CrudDialog>
  );
}

function EditScopesDialog({ client, scopeNames, isSubmitting, onClose, onSubmit }) {
  const [scopes, setScopes] = useState(getEffectiveScopes(client).map(scopeName));

  function toggleScope(scope, checked) {
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((item) => item !== scope),
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (scopes.length === 0) {
      showErrorToast("At least one scope is required.");
      return;
    }
    onSubmit(scopes);
  }

  return (
    <CrudDialog
      title="Edit Legacy Scopes"
      description={client.name}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="edit-scopes-form" type="submit" loading={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-scopes-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-2 sm:grid-cols-2">
          {scopeNames.map((scope) => (
            <CheckboxField
              key={scope}
              label={scope}
              checked={scopes.includes(scope)}
              onChange={(event) => toggleScope(scope, event.target.checked)}
            />
          ))}
        </div>
      </form>
    </CrudDialog>
  );
}

function getCredentials(client) {
  if (client.credentials?.length) return client.credentials;
  return client.token_prefix
    ? [{ token_prefix: client.token_prefix, status: client.is_active ? "ACTIVE" : "REVOKED" }]
    : [];
}

function CredentialSummary({ client }) {
  const credentials = getCredentials(client);
  const current =
    credentials.find((credential) => (credential.status || "ACTIVE") === "ACTIVE") ||
    credentials[0];
  const retiring = credentials.find((credential) => credential.status === "RETIRING");

  if (!current) return <span className="text-xs text-(--mws-muted)">-</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <code className="text-xs text-(--mws-charcoal)">
          {current.token_prefix || current.prefix || "Credential"}
        </code>
        <StatusBadge tone={credentialStatusTone(current.status || "ACTIVE")}>
          {formatStatus(current.status || "ACTIVE")}
        </StatusBadge>
      </div>
      {retiring ? (
        <p className="text-xs text-[#745716]">
          Old token retires {retiring.expires_at ? formatDateTime(retiring.expires_at) : "soon"}
        </p>
      ) : null}
    </div>
  );
}

function ClientActionsMenu({ client, onRotate, onEditScopes, onRevokeCredential, onRevoke, isBusy }) {
  const active = clientIsActive(client);
  const retiring = getCredentials(client).filter(
    (credential) => credential.status === "RETIRING",
  );

  return (
    <ActionsMenu label={`Actions for ${client.profile?.name || client.name}`}>
      {(close) => (
        <>
          <ActionsMenuItem
            disabled={!active || isBusy}
            onClick={() => {
              close();
              onRotate();
            }}
          >
            Rotate Credentials
          </ActionsMenuItem>
          {!client.profile ? (
            <ActionsMenuItem
              disabled={!active}
              onClick={() => {
                close();
                onEditScopes();
              }}
            >
              Edit Legacy Scopes
            </ActionsMenuItem>
          ) : null}
          {retiring.map((credential) => (
            <ActionsMenuItem
              key={credential.id || credential.token_prefix}
              onClick={() => {
                close();
                onRevokeCredential(credential);
              }}
            >
              Revoke Old Token
            </ActionsMenuItem>
          ))}
          <div className="my-1 border-t border-(--mws-line)" />
          <ActionsMenuItem
            tone="danger"
            disabled={!active || isBusy}
            onClick={() => {
              close();
              onRevoke();
            }}
          >
            Revoke Client
          </ActionsMenuItem>
        </>
      )}
    </ActionsMenu>
  );
}

function getEffectiveScopes(client) {
  return client.effective_scopes || client.scopes || [];
}

function clientIsActive(client) {
  return client.status ? client.status === "ACTIVE" : client.is_active;
}

function credentialStatusTone(status) {
  if (status === "ACTIVE") return "green";
  if (status === "RETIRING") return "amber";
  return "red";
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase().replaceAll("_", "-");
}

function formatEnvironment(value) {
  if (!value) return "-";
  if (value === "Server Managed") return value;
  return formatStatus(String(value).toUpperCase().replaceAll("-", "_"));
}

function formatLabel(value) {
  return formatStatus(String(value || "").toUpperCase().replaceAll("-", "_"));
}
