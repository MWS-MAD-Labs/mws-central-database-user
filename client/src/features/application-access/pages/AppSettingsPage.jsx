import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, ShieldCheck } from "lucide-react";
import { Link, Navigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { ToggleChip } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { ApplicationManagementDialogs } from "../components/ApplicationManagementDialogs.jsx";
import { CopyableId } from "../components/CopyableId.jsx";
import { HubSettingsCard } from "../components/HubSettingsCard.jsx";
import { useApplicationManagement } from "../hooks/useApplicationManagement.js";
import { useInternalEndpoints } from "../hooks/useInternalEndpoints.js";
import { buildSteps, stepsDone, timeAgo } from "../utils/setupSteps.js";

const CARD_STATUS_LABEL = { active: "Active", maintenance: "Maintenance", coming_soon: "Coming Soon", new: "New" };

// One bar of the panel: a title, the one action that belongs to it, and what is below.
function Part({ title, action, children }) {
  return (
    <section className="space-y-3 px-5 py-4">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-sm font-bold text-(--mws-charcoal)">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-(--mws-muted)">{label}</dt>
          <dd className="min-w-0 break-words text-(--mws-charcoal)">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// What can still change once an application is set up. The setup steps were for the first time. One panel, one way to
// edit the details, and the guide one click away for anyone who forgot how a part works.
export function AppSettingsPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: user?.role === "SUPER_ADMIN",
  });
  const mgmt = useApplicationManagement(applicationId, setupQuery.data);
  const { countFor, loaded: endpointsLoaded } = useInternalEndpoints();
  const base = `/application-access/apps/${applicationId}`;
  const guide = `${base}/guide`;

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title={applicationId} />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (setupQuery.isLoading) return <PanelMessage>Loading settings…</PanelMessage>;
  if (setupQuery.isError || !setupQuery.data) return <PanelMessage tone="error">This application could not be found.</PanelMessage>;

  const setup = setupQuery.data;
  const steps = buildSteps(setup);
  // An application that was never finished still has its steps to do.
  if (!setup.setup_completed && stepsDone(steps) < steps.length) return <Navigate to={`${base}/setup`} replace />;

  const app = setup.application;
  const retired = Boolean(app.retired_at);
  const link = app.launch_mode === "link";
  const endpointCount = countFor(setup.data_access.scope_names);
  const { setEditing, setRotating, setDataAccess, setRemoving, setRemovalGuide, restoreMutation, publishMutation, connectMutation, appSecretMutation, retire, changeAppSecret } = mgmt;
  const canShow = setup.can_publish && Boolean(app.launch_url);

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={`${app.name} Settings`}
        description="Change how this application is set up. The setup steps were for the first time, the guide explains each part again."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={base}>
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to={`${guide}?part=local`}>
                <BookOpen size={16} />
                Setup Guide
              </Link>
            </Button>
            {setup.is_hub && !retired && !setup.removal.retire_available && !setup.removal.can_remove ? null : (
              <ActionsMenu label="More actions">
                {(closeMenu) => (
                  <>
                    <ActionsMenuItem
                      onClick={() => {
                        closeMenu();
                        setRemovalGuide(true);
                      }}
                    >
                      How Removing Works
                    </ActionsMenuItem>
                    <div className="my-1 border-t border-(--mws-line)" />
                    {retired ? (
                      <ActionsMenuItem
                        tone="success"
                        onClick={() => {
                          closeMenu();
                          restoreMutation.mutate();
                        }}
                      >
                        Restore Application
                      </ActionsMenuItem>
                    ) : !setup.is_hub || setup.removal.retire_available ? (
                      <ActionsMenuItem
                        tone="warning"
                        onClick={() => {
                          closeMenu();
                          retire();
                        }}
                      >
                        Retire Application
                      </ActionsMenuItem>
                    ) : null}
                    {retired || setup.removal.can_remove ? (
                      <ActionsMenuItem
                        tone="danger"
                        onClick={() => {
                          closeMenu();
                          setRemoving(true);
                        }}
                      >
                        Delete Application
                      </ActionsMenuItem>
                    ) : null}
                  </>
                )}
              </ActionsMenu>
            )}
          </>
        }
      />

      {retired ? (
        <div role="note" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#e3a2a5] bg-[#fff0f1] px-5 py-3 text-sm text-[#a43c41]">
          <span className="font-semibold">Retired</span>
          <span>Its token is revoked, it is hidden from the Hub and nobody has access. Nothing was deleted.</span>
          <span className="ml-auto flex gap-4">
            <TextAction onClick={() => restoreMutation.mutate()}>Restore</TextAction>
            <TextAction onClick={() => setRemoving(true)}>Delete</TextAction>
          </span>
        </div>
      ) : null}

      {setup.is_hub ? (
        <>
          <div role="note" className="flex items-center gap-3 rounded-2xl border border-[#d9a9ac] bg-[#7E15180D] px-5 py-3 text-sm text-(--mws-burgundy)">
            <ShieldCheck size={18} aria-hidden="true" className="shrink-0" />
            <span>
              <span className="font-semibold">This is the Hub itself.</span> Every other application signs in through it.
            </span>
          </div>
          {setup.env_settings ? <HubSettingsCard settings={setup.env_settings} hub={setup.hub} applicationId={applicationId} /> : null}
        </>
      ) : null}

      <div className="divide-y divide-(--mws-line) rounded-2xl border border-(--mws-line) bg-white">
        <Part
          title="Details"
          action={
            retired ? null : (
              <TextAction onClick={() => setEditing(true)}>Edit</TextAction>
            )
          }
        >
          <Rows
            rows={[
              ["Name", app.name],
              ...(setup.is_hub ? [] : [["Address", <span key="a" className="font-mono text-xs">{app.launch_url || "Not set"}</span>]]),
              ...(setup.is_hub ? [] : [["Organization ID", <CopyableId key="o" value={setup.organization_id} />]]),
              ...(app.category ? [["Category", app.category]] : []),
              ...(app.scope ? [["Scope", app.scope]] : []),
              ...(setup.is_hub ? [] : [["Card", `${CARD_STATUS_LABEL[app.hub_status] ?? "Active"}${(app.hub_keywords ?? []).length > 0 ? `, ${app.hub_keywords.join(", ")}` : ""}`]]),
            ]}
          />
        </Part>

        {setup.is_hub ? null : (
          <Part
            title="Shown in the Hub"
            action={
              <ToggleChip
                checked={app.published}
                disabled={retired || publishMutation.isPending || (!app.published && !canShow)}
                onChange={(next) => publishMutation.mutate(next)}
              >
                {app.published ? "Shown" : "Hidden"}
              </ToggleChip>
            }
          >
            <p className="text-sm text-(--mws-muted)">
              {app.published ? "People a group covers see its card." : canShow ? "Nobody sees its card." : "Finish the groups and the address before it can be shown."}
            </p>
          </Part>
        )}

        {link ? null : (
          <Part
            title="Connection"
            action={
              retired || setup.connection.created ? null : (
                <TextAction loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
                  Create Connection
                </TextAction>
              )
            }
          >
            <Rows
              rows={[
                ["Last call", setup.connection.last_used_at ? `${timeAgo(setup.connection.last_used_at)} ago` : "Never"],
                ["Permissions", `${setup.permissions.count}${setup.permissions.synced_at ? `, received ${timeAgo(setup.permissions.synced_at)} ago` : ""}`],
                ...(setup.hub_secret?.applies ? [["Hub secret", setup.hub_secret.mode === "own" ? `Its own, version ${setup.hub_secret.version}` : "The Hub's shared secret"]] : []),
              ]}
            />
            {retired || !setup.connection.created ? null : (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <TextAction onClick={() => setRotating(true)}>Rotate Token</TextAction>
                {setup.hub_secret?.applies ? (
                  <TextAction loading={appSecretMutation.isPending} onClick={changeAppSecret}>
                    {setup.hub_secret.mode === "own" ? "Rotate Hub Secret" : "Give Its Own Hub Secret"}
                  </TextAction>
                ) : null}
                {endpointsLoaded && setup.data_access.editable ? (
                  <TextAction onClick={() => setDataAccess(true)}>{`Data Access, ${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`}</TextAction>
                ) : null}
                <TextAction asChild>
                  <Link to={`${guide}?part=rotate`}>Rotation Guide</Link>
                </TextAction>
              </div>
            )}
          </Part>
        )}

        <Part title="Access">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <TextAction asChild>
              <Link to={base}>{`${setup.groups.active_count} active group${setup.groups.active_count === 1 ? "" : "s"}`}</Link>
            </TextAction>
            <TextAction asChild>
              <Link to={`${base}?tab=roles`}>{`${setup.roles.active_count} role${setup.roles.active_count === 1 ? "" : "s"}`}</Link>
            </TextAction>
            {link ? null : (
              <TextAction asChild>
                <Link to={`${base}?tab=permissions`}>{`${setup.permissions.count} permission${setup.permissions.count === 1 ? "" : "s"}`}</Link>
              </TextAction>
            )}
          </div>
        </Part>
      </div>

      <ApplicationManagementDialogs applicationId={applicationId} setup={setup} mgmt={mgmt} />
    </div>
  );
}
