import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { CheckboxField } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDateTime, formatStatus } from "../../../lib/format.js";
import { isPendingFor } from "../../../lib/mutationState.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { apiClientsApi } from "../api/apiClientsApi.js";
import { InternalApiPanel } from "../components/InternalApiPanel.jsx";
import { RotateTokenFlow } from "../components/RotateTokenFlow.jsx";
import { ScopeGroupPills } from "../components/ScopeGroupPills.jsx";
import { usePagedList } from "../hooks/usePagedList.js";
import { PURPOSE_LABELS, scopeName } from "../utils/scopes.js";

// What connected apps can ask for. Connections of applications are made and managed in Application
// Access, so only clients that belong to no application are listed here.
export function ApiClientsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [scopesDialogFor, setScopesDialogFor] = useState(null);
  const [rotateFor, setRotateFor] = useState(null);

  const clientsQuery = useQuery({ queryKey: ["api-clients"], queryFn: apiClientsApi.list });
  const profilesQuery = useQuery({ queryKey: ["application-integration-profiles"], queryFn: apiClientsApi.listProfiles });
  const internalEndpointsQuery = useQuery({
    queryKey: ["api-clients", "internal-endpoints"],
    queryFn: apiClientsApi.listInternalEndpoints,
  });
  const internalEndpoints = internalEndpointsQuery.data || [];
  const scopeNames = [...new Set(internalEndpoints.map((endpoint) => endpoint.scope))];

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
    mutationFn: ({ clientId, credentialId }) => apiClientsApi.revokeCredential(clientId, credentialId),
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
      revokeCredentialMutation.mutate({ clientId: client.id, credentialId: credential.id });
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

  const profiles = profilesQuery.data?.profiles || [];
  // Profiles that belong to an application added in Application Access, by code.
  const applicationProfiles = profiles.filter((profile) => profile.application);
  const applicationCodes = new Set(applicationProfiles.map((profile) => profile.code));
  const others = (clientsQuery.data || []).filter((client) => !applicationCodes.has(client.profile?.code));
  const clientPaging = usePagedList(others);
  const serverEnvironment =
    profilesQuery.data?.environment ||
    others.find((client) => client.environment)?.environment ||
    "Server Managed";

  return (
    <div className="min-w-0">
      <PageHeader
        title="API Reference"
        description="What connected MWS apps can ask for. Connections are made in Application Access when you add an application."
      />

      <InternalApiPanel endpoints={internalEndpoints} profiles={applicationProfiles} isLoading={internalEndpointsQuery.isLoading} />

      {!clientsQuery.isLoading && others.length > 0 ? (
        <section className="mt-5 min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="flex min-w-0 items-center gap-3 border-b border-(--mws-line) p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
              <KeyRound size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Other Clients</h2>
              <p className="text-xs text-(--mws-muted)">Clients that belong to no application. Revoke the ones nobody uses.</p>
            </div>
          </div>

          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Scopes</th>
                  <th className="px-4 py-3">Credential</th>
                  <th className="px-4 py-3">Last Used</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {clientPaging.pageItems.map((client) => (
                  <tr key={client.id} id={`api-client-${client.id}`} className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {client.profile?.name || client.application || client.name}
                        {!client.profile ? <StatusBadge tone="amber" className="ml-2 align-middle">Legacy</StatusBadge> : null}
                      </p>
                      <p className="max-w-xs truncate text-xs text-(--mws-muted)">{client.description || "-"}</p>
                      <p className="mt-0.5 text-xs text-(--mws-muted)">
                        {[
                          formatEnvironment(client.environment || serverEnvironment),
                          client.purpose ? PURPOSE_LABELS[client.purpose] || formatLabel(client.purpose) : null,
                          client.profile?.version ?? client.profile_version ? `v${client.profile?.version ?? client.profile_version}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="px-4 py-3"><ScopeGroupPills scopes={getEffectiveScopes(client)} /></td>
                    <td className="px-4 py-3"><CredentialSummary client={client} /></td>
                    <td className="px-4 py-3">{formatDateTime(client.last_used_at)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={clientIsActive(client) ? "green" : "red"}>
                        {formatStatus(client.status || (client.is_active ? "ACTIVE" : "REVOKED"))}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ClientActionsMenu
                        client={client}
                        onRotate={() => setRotateFor(client)}
                        onEditScopes={() => setScopesDialogFor(client)}
                        onRevokeCredential={(credential) => handleRevokeCredential(client, credential)}
                        onRevoke={() => handleRevoke(client)}
                        isBusy={isPendingFor(revokeMutation, client.id)}
                      />
                    </td>
                  </tr>
                ))}
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
      ) : null}

      {rotateFor ? (
        <RotateTokenFlow
          title={rotateFor.profile?.name || rotateFor.name}
          rotate={({ mode, graceSeconds }) => apiClientsApi.rotate({ id: rotateFor.id, mode, graceSeconds })}
          onRotated={() => queryClient.invalidateQueries({ queryKey: ["api-clients"] })}
          onClose={() => setRotateFor(null)}
        />
      ) : null}

      {scopesDialogFor ? (
        <EditScopesDialog
          client={scopesDialogFor}
          scopeNames={scopeNames}
          isSubmitting={updateScopesMutation.isPending}
          onClose={() => setScopesDialogFor(null)}
          onSubmit={(scopeNames) => updateScopesMutation.mutate({ id: scopesDialogFor.id, scopeNames })}
        />
      ) : null}
    </div>
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


function formatEnvironment(value) {
  if (!value) return "-";
  if (value === "Server Managed") return value;
  return formatStatus(String(value).toUpperCase().replaceAll("-", "_"));
}

function formatLabel(value) {
  return formatStatus(String(value || "").toUpperCase().replaceAll("-", "_"));
}
