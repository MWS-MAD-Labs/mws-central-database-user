import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, KeyRound, ShieldCheck, Check, Circle, Eye, EyeOff, Loader2, Lock, Pencil, Plus, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { isPendingFor } from "../../../lib/mutationState.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { ApplicationManagementDialogs } from "../components/ApplicationManagementDialogs.jsx";
import { AddressLink } from "../components/AddressLink.jsx";
import { CopyableId } from "../components/CopyableId.jsx";
import { HubSettingsCard } from "../components/HubSettingsCard.jsx";
import { useApplicationManagement } from "../hooks/useApplicationManagement.js";
import { useInternalEndpoints } from "../hooks/useInternalEndpoints.js";
import { buildSteps, stepsDone } from "../utils/setupSteps.js";
import { canManageApplications } from "../utils/canManageApplications.js";
import { appHomeUrl } from "../utils/sessionDomain.js";

const POLL_MS = 5000;
const STALLED_MS = 10 * 60 * 1000;
const TITLES = {
  about: "About",
  connect: "Connect",
  permissions: "Permissions",
  roles: "Roles",
  groups: "Groups",
  hub: "Show in Hub",
};

export function AppSetupPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const { countFor, loaded: endpointsLoaded } = useInternalEndpoints();
  // Ticks so the ten minute note can appear without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: canManageApplications(user),
    // Only while the application is expected to call Central, otherwise nothing changes by itself.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.application.retired_at) return false;
      return data.connection.created && data.permissions.count === 0 ? POLL_MS : false;
    },
  });
  const guideBase = `/application-access/apps/${applicationId}/guide`;
  const mgmt = useApplicationManagement(applicationId, setupQuery.data);
  const { setEditing, setRotating, setDataAccess, setRemoving, setRemovalGuide, navigate, restoreMutation, publishMutation, connectMutation, appSecretMutation, retire, changeAppSecret } = mgmt;

  if (!canManageApplications(user)) {
    return (
      <div className="min-w-0">
        <PageHeader title={applicationId} />
        <PanelMessage>Only a protected Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (setupQuery.isLoading) return <PanelMessage>Loading setup…</PanelMessage>;
  if (setupQuery.isError || !setupQuery.data) {
    return <PanelMessage tone="error">This application could not be found.</PanelMessage>;
  }

  const setup = setupQuery.data;
  const steps = buildSteps(setup);
  // The steps are for the first time. Once the application was shown in the Hub, or every step is done, Settings takes over.
  if (setup.setup_completed || stepsDone(steps) === steps.length) return <Navigate to={`/application-access/apps/${applicationId}/settings`} replace />;
  const endpointCount = countFor(setup.data_access.scope_names);
  const finished = stepsDone(steps);
  const base = `/application-access/apps/${applicationId}`;
  const publishing = isPendingFor(publishMutation, () => true);

  // One main button, on the step that is next. Everything else is a quiet text button.
  const retired = Boolean(setup.application.retired_at);

  function actions(step) {
    if (retired || step.status === "locked") return null;
    const current = step.status === "current";
    const quiet = (to, label, icon) => (
      <TextAction asChild icon={icon}>
        <Link to={to}>{label}</Link>
      </TextAction>
    );
    switch (step.id) {
      case "about":
        return (
          <TextAction icon={Pencil} onClick={() => setEditing(true)}>
            Edit Details
          </TextAction>
        );
      case "connect":
        return setup.connection.created ? (
          <>
            {endpointsLoaded && setup.data_access.editable ? (
              <TextAction icon={ShieldCheck} onClick={() => setDataAccess(true)}>
                {`Data Access, ${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`}
              </TextAction>
            ) : null}
            <TextAction asChild icon={BookOpen}>
              <Link to={`${guideBase}?part=local`}>Setup Guide</Link>
            </TextAction>
            {setup.hub_secret?.applies ? (
              <TextAction icon={KeyRound} loading={appSecretMutation.isPending} onClick={changeAppSecret}>
                {setup.hub_secret.mode === "own" ? "Rotate Hub Secret" : "Give Its Own Hub Secret"}
              </TextAction>
            ) : null}
            <TextAction icon={RotateCw} onClick={() => setRotating(true)}>
              Rotate Token
            </TextAction>
          </>
        ) : (
          <Button type="button" loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
            Create Connection
          </Button>
        );
      case "permissions":
        return step.done ? quiet(`${base}?tab=permissions`, "View Permissions", Eye) : null;
      case "roles":
        return (
          <>
            {current ? (
              <Button asChild>
                <Link to={`${base}/roles/bulk?from=setup`}>Add Roles</Link>
              </Button>
            ) : (
              quiet(`${base}/roles/bulk?from=setup`, "Add Roles", Plus)
            )}
          </>
        );
      case "groups":
        return current ? (
          <Button asChild>
            <Link to={`${base}/groups/new`}>Add Group</Link>
          </Button>
        ) : (
          quiet(`${base}/groups/new`, "Add Group", Plus)
        );
      case "hub":
        return step.done ? (
          <TextAction icon={EyeOff} loading={publishing} onClick={() => publishMutation.mutate(false)}>
            Hide From Hub
          </TextAction>
        ) : (
          <Button type="button" loading={publishing} disabled={!setup.can_publish || !setup.application.launch_url} onClick={() => publishMutation.mutate(true)}>
            Show In Hub
          </Button>
        );
      default:
        return null;
    }
  }

  // Where to open the application once, so it connects.
  const openUrl = setup.is_hub ? (setup.hub?.base_url ?? "") : appHomeUrl(setup.application.launch_url);
  const waiting = setup.connection.created && steps.find((step) => step.id === "connect")?.status === "current";
  const stalled =
    waiting && setup.connection.created_at && now - new Date(setup.connection.created_at).getTime() > STALLED_MS;

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={`Set Up ${setup.application.name}`}
        description={`${finished} of ${steps.length} steps done. You can leave and come back, this page reads the progress from the data.`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={`/application-access/apps/${applicationId}`}>
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            <ActionsMenu label="More actions">
              {(closeMenu) => (
                <>
                  <ActionsMenuItem
                    onClick={() => {
                      closeMenu();
                      navigate(base);
                    }}
                  >
                    Open Application
                  </ActionsMenuItem>
                  <ActionsMenuItem
                    onClick={() => {
                      closeMenu();
                      setEditing(true);
                    }}
                  >
                    Edit Details
                  </ActionsMenuItem>
                  {setup.data_access.editable ? (
                    <ActionsMenuItem
                      onClick={() => {
                        closeMenu();
                        setDataAccess(true);
                      }}
                    >
                      Change Data Access
                    </ActionsMenuItem>
                  ) : null}
                  <ActionsMenuItem
                    onClick={() => {
                      closeMenu();
                      navigate(guideBase);
                    }}
                  >
                    Setup Guide
                  </ActionsMenuItem>
                  <ActionsMenuItem
                    onClick={() => {
                      closeMenu();
                      setRemovalGuide(true);
                    }}
                  >
                    How Removing Works
                  </ActionsMenuItem>
                  {setup.is_hub && !retired && !setup.removal.retire_available && !setup.removal.can_remove ? null : (
                    <>
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
                </>
              )}
            </ActionsMenu>
          </>
        }
      />

      {setup.is_hub ? (
        <div role="note" className="flex items-center gap-3 rounded-2xl border border-[#d9a9ac] bg-[#7E15180D] px-5 py-3 text-sm text-(--mws-burgundy)">
          <ShieldCheck size={18} aria-hidden="true" className="shrink-0" />
          <span>
            <span className="font-semibold">This is the Hub itself.</span> Every other application signs in through it, so it can only be removed after they are.
          </span>
        </div>
      ) : null}

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

      {setup.is_hub ? null : (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-3 text-sm">
          <span className="font-semibold text-(--mws-charcoal)">Organization ID</span>
          <CopyableId value={setup.organization_id} />
          <span className="text-(--mws-muted)">Already included in the values you copy when you create the connection.</span>
        </div>
      )}

      {setup.is_hub && setup.env_settings ? (
        <HubSettingsCard
          settings={setup.env_settings}
          hub={setup.hub}
          applicationId={applicationId}
        />
      ) : null}

      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            data-status={step.status}
            className={`flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-5 ${
              step.status === "current" ? "border-(--mws-burgundy)" : "border-(--mws-line)"
            } ${step.status === "locked" ? "opacity-60" : ""}`}
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                step.done ? "bg-[#edf4eb] text-[#476b43]" : step.status === "current" ? "bg-(--mws-burgundy) text-white" : "bg-(--mws-soft) text-(--mws-muted)"
              }`}
              aria-hidden="true"
            >
              {step.done ? <Check size={18} /> : step.status === "locked" ? <Lock size={15} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
                {TITLES[step.id]}
                <span className="sr-only">{step.done ? " (done)" : step.status === "current" ? " (next)" : " (locked)"}</span>
              </h2>
              <p className="flex items-center gap-2 text-sm text-(--mws-muted)">
                {step.status === "current" && step.id === "permissions" && setup.connection.created ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : step.status === "current" ? (
                  <Circle size={8} aria-hidden="true" />
                ) : null}
                {step.note}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">{actions(step)}</div>
            {step.id === "connect" && waiting ? (
              <div className="w-full rounded-xl border border-(--mws-line) bg-(--mws-soft) p-4">
                <p className="font-display text-sm font-bold text-(--mws-charcoal)">Do This Next</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-(--mws-charcoal)">
                  <li>Put the .env values you copied in the application.</li>
                  <li>On your machine, run the permission sync by hand or start the application if it sends them on start.</li>
                  <li>In production, the deploy pipeline should run the sync after Central is deployed.</li>
                </ol>
                <p className="mt-2 text-xs text-(--mws-muted)">
                  Cannot run the application yet? The setup guide has one command that does the same from a terminal.
                </p>
                {openUrl ? (
                  <p className="mt-2 text-xs text-(--mws-muted)">
                    Open it once so it can connect: <AddressLink url={openUrl} />
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-(--mws-muted)">This page checks every few seconds and updates by itself.</p>
                {stalled ? (
                  <p role="note" className="mt-3 rounded-lg border border-[#f3d7a3] bg-[#fff8e8] px-3 py-2 text-xs text-[#805b18]">
                    Still nothing after 10 minutes. The token of this connection has not been used yet. Check that the .env of the
                    application has these names: {(setup.env_keys ?? []).map((item) => item.key).join(", ")}. An older variable with
                    another name can be read first and keep the new token from being used. Check that it was restarted, and that this
                    block was made for the application that reads it (its ID here is {applicationId}). Then send the permissions once
                    from your machine, as in the{" "}
                    <Link to={`${guideBase}?part=troubleshooting`} className="font-semibold underline">
                      Setup Guide
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <ApplicationManagementDialogs applicationId={applicationId} setup={setup} mgmt={mgmt} />
    </div>
  );
}
