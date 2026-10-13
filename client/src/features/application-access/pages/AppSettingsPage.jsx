import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Eye, EyeOff, KeyRound, Pencil, RotateCw, ShieldCheck } from "lucide-react";
import { Link, Navigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
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

function Card({ title, description, actions, children }) {
  return (
    <section className="space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-(--mws-charcoal)">{title}</h2>
          {description ? <p className="text-sm text-(--mws-muted)">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-(--mws-muted)">{label}</dt>
          <dd className="min-w-0 break-words text-(--mws-charcoal)">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// What can still change once an application is set up: its details, connection, card in the Hub and removal. The setup
// steps are only for the first time. The guide stays one click away for anyone who forgot how a part works.
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
          </>
        }
      />

      {retired ? (
        <div role="note" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e3a2a5] bg-[#fff0f1] px-5 py-3 text-sm text-[#a43c41]">
          <span className="font-semibold">Retired</span>
          <span>Its token is revoked, it is hidden from the Hub and nobody has access. Nothing was deleted.</span>
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" size="sm" loading={restoreMutation.isPending} onClick={() => restoreMutation.mutate()}>
              Restore
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => setRemoving(true)}>
              Delete
            </Button>
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
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-3 text-sm">
          <span className="font-semibold text-(--mws-charcoal)">Organization ID</span>
          <CopyableId value={setup.organization_id} />
        </div>
      )}

      <Card
        title="Details"
        description="What the card shows and where it opens."
        actions={
          retired ? null : (
            <TextAction icon={Pencil} onClick={() => setEditing(true)}>
              Edit Details
            </TextAction>
          )
        }
      >
        <Facts
          rows={[
            ["Name", app.name],
            ...(setup.is_hub ? [] : [["Address", <span className="font-mono text-xs">{app.launch_url || "Not set"}</span>]]),
            ...(app.category ? [["Category", app.category]] : []),
            ...(app.scope ? [["Scope", app.scope]] : []),
          ]}
        />
      </Card>

      {link ? null : (
        <Card
          title="Connection"
          description="How the application talks to Central."
          actions={
            retired ? null : setup.connection.created ? (
              <>
                {endpointsLoaded && setup.data_access.editable ? (
                  <TextAction icon={ShieldCheck} onClick={() => setDataAccess(true)}>
                    {`Data Access, ${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`}
                  </TextAction>
                ) : null}
                {setup.hub_secret?.applies ? (
                  <TextAction icon={KeyRound} loading={appSecretMutation.isPending} onClick={changeAppSecret}>
                    {setup.hub_secret.mode === "own" ? "Rotate Hub Secret" : "Give Its Own Hub Secret"}
                  </TextAction>
                ) : null}
                <TextAction icon={RotateCw} onClick={() => setRotating(true)}>
                  Rotate Token
                </TextAction>
                <TextAction asChild icon={BookOpen}>
                  <Link to={`${guide}?part=rotate`}>Rotation Guide</Link>
                </TextAction>
              </>
            ) : (
              <Button type="button" loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
                Create Connection
              </Button>
            )
          }
        >
          <Facts
            rows={[
              ["Last call", setup.connection.last_used_at ? `${timeAgo(setup.connection.last_used_at)} ago` : "Never"],
              ["Permissions", `${setup.permissions.count}${setup.permissions.synced_at ? `, received ${timeAgo(setup.permissions.synced_at)} ago` : ""}`],
              ...(setup.hub_secret?.applies ? [["Hub secret", setup.hub_secret.mode === "own" ? `Its own, version ${setup.hub_secret.version}` : "The Hub's shared secret"]] : []),
            ]}
          />
        </Card>
      )}

      {setup.is_hub ? null : (
        <Card
          title="Hub Card"
          description="Whether people see this application in the Hub."
          actions={
            retired ? null : app.published ? (
              <TextAction icon={EyeOff} loading={publishMutation.isPending} onClick={() => publishMutation.mutate(false)}>
                Hide From Hub
              </TextAction>
            ) : (
              <Button type="button" loading={publishMutation.isPending} disabled={!setup.can_publish || !app.launch_url} onClick={() => publishMutation.mutate(true)}>
                <Eye size={16} />
                Show In Hub
              </Button>
            )
          }
        >
          <p className="text-sm text-(--mws-charcoal)">
            {app.published ? "Showing in the Hub for people a group covers." : "Hidden. Nobody sees its card in the Hub."}
          </p>
          <Facts
            rows={[
              ["Status", CARD_STATUS_LABEL[app.hub_status] ?? "Active"],
              ["Keywords", (app.hub_keywords ?? []).length > 0 ? app.hub_keywords.join(", ") : "None"],
            ]}
          />
          {retired ? null : (
            <TextAction icon={Pencil} onClick={() => setEditing(true)}>
              Change Status Or Keywords
            </TextAction>
          )}
        </Card>
      )}

      <Card title="Access" description="Who may use it, and with which role.">
        <div className="flex flex-wrap gap-4 text-sm">
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
      </Card>

      {setup.is_hub && !retired && !setup.removal.retire_available && !setup.removal.can_remove ? null : (
        <Card
          title="Remove"
          description="Retire it to stop it without deleting anything. Delete only when nobody uses it."
          actions={
            <>
              <TextAction icon={BookOpen} onClick={() => setRemovalGuide(true)}>
                How Removing Works
              </TextAction>
              {retired ? null : !setup.is_hub || setup.removal.retire_available ? (
                <Button type="button" variant="secondary" onClick={retire}>
                  Retire Application
                </Button>
              ) : null}
              {retired || setup.removal.can_remove ? (
                <Button type="button" variant="danger" onClick={() => setRemoving(true)}>
                  Delete Application
                </Button>
              ) : null}
            </>
          }
        />
      )}

      <ApplicationManagementDialogs applicationId={applicationId} setup={setup} mgmt={mgmt} />
    </div>
  );
}
