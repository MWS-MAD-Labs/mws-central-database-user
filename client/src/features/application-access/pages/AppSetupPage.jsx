import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Circle, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { isPendingFor } from "../../../lib/mutationState.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { AppDetailsForm } from "../components/AppDetailsForm.jsx";
import { ConnectDialog } from "../components/ConnectDialog.jsx";
import { CopyableId } from "../components/CopyableId.jsx";
import { RemoveApplicationDialog } from "../components/RemoveApplicationDialog.jsx";
import { SetupGuideDialog } from "../components/SetupGuideDialog.jsx";
import { buildSteps, stepsDone } from "../utils/setupSteps.js";

const BACK = "/application-access";
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
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const [connection, setConnection] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [guide, setGuide] = useState(false);
  // Ticks so the ten minute note can appear without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: user?.role === "SUPER_ADMIN",
    // Only while the application is expected to call Central, otherwise nothing changes by itself.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.connection.created && data.permissions.count === 0 ? POLL_MS : false;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["application-access"] });

  const connectMutation = useMutation({
    mutationFn: () => applicationAccessApi.connect(applicationId),
    onSuccess: (response) => {
      setConnection(response);
      refresh();
    },
    onError: (error) => showErrorToast(error, "Could not create the connection."),
  });
  const updateMutation = useMutation({
    mutationFn: (payload) => applicationAccessApi.updateDetails(applicationId, payload),
    onSuccess: () => {
      setEditing(false);
      refresh();
      showSuccessToast("Details saved.");
    },
    onError: (error) => showErrorToast(error, "Could not save the details."),
  });
  const adminRoleMutation = useMutation({
    mutationFn: async () => {
      const catalog = await applicationAccessApi.listPermissions(applicationId);
      const keys = catalog.permissions.filter((permission) => !permission.deprecated).map((permission) => permission.key);
      return applicationAccessApi.createRole({
        application_id: applicationId,
        key: "ADMIN",
        label: "Admin",
        permissions: keys,
        allows_employees: true,
      });
    },
    onSuccess: () => {
      refresh();
      showSuccessToast("Admin role created.");
    },
    onError: (error) => showErrorToast(error, "Could not create the Admin role."),
  });
  const publishMutation = useMutation({
    mutationFn: (publish) => (publish ? applicationAccessApi.publish(applicationId) : applicationAccessApi.unpublish(applicationId)),
    onSuccess: (_data, publish) => {
      refresh();
      showSuccessToast(publish ? "The application will now show in the Hub." : "The application is hidden from the Hub.");
    },
    onError: (error) => showErrorToast(error, "Could not change this."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title={applicationId} />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (setupQuery.isLoading) return <PanelMessage>Loading setup…</PanelMessage>;
  if (setupQuery.isError || !setupQuery.data) {
    return <PanelMessage tone="error">This application could not be found.</PanelMessage>;
  }

  const setup = setupQuery.data;
  const steps = buildSteps(setup);
  const finished = stepsDone(steps);
  const base = `/application-access/apps/${applicationId}`;
  const publishing = isPendingFor(publishMutation, () => true);

  // One main button, on the step that is next. Everything else is a quiet text button.
  function actions(step) {
    if (step.status === "locked") return null;
    const current = step.status === "current";
    const quiet = (to, label) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={to}>{label}</Link>
      </Button>
    );
    switch (step.id) {
      case "connect":
        return setup.connection.created ? (
          quiet("/api-clients", "Rotate Token")
        ) : (
          <Button type="button" loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
            Create Connection
          </Button>
        );
      case "permissions":
        return step.done ? quiet(`${base}?tab=permissions`, "View Permissions") : null;
      case "roles":
        return (
          <>
            {current && setup.permissions.count > 0 ? (
              <Button type="button" loading={adminRoleMutation.isPending} onClick={() => adminRoleMutation.mutate()}>
                Create Admin Role
              </Button>
            ) : null}
            {quiet(`${base}/roles/new`, "Add Role")}
          </>
        );
      case "groups":
        return current ? (
          <Button asChild>
            <Link to={`${base}/groups/new`}>Add Group</Link>
          </Button>
        ) : (
          quiet(`${base}/groups/new`, "Add Group")
        );
      case "hub":
        return step.done ? (
          <Button type="button" variant="ghost" size="sm" loading={publishing} onClick={() => publishMutation.mutate(false)}>
            Hide From Hub
          </Button>
        ) : (
          <Button type="button" loading={publishing} disabled={!setup.can_publish || !setup.application.launch_url} onClick={() => publishMutation.mutate(true)}>
            Show In Hub
          </Button>
        );
      default:
        return null;
    }
  }

  const waiting = setup.connection.created && steps[1].status === "current";
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
              <Link to={BACK}>
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
                  <ActionsMenuItem
                    tone="danger"
                    onClick={() => {
                      closeMenu();
                      setRemoving(true);
                    }}
                  >
                    Delete Application
                  </ActionsMenuItem>
                </>
              )}
            </ActionsMenu>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-3 text-sm">
        <span className="font-semibold text-(--mws-charcoal)">Organization ID</span>
        <CopyableId value={setup.organization_id} />
        <span className="text-(--mws-muted)">Already included in the values you copy when you create the connection.</span>
      </div>

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
                  <li>Make sure the application sends its permissions when it starts.</li>
                  <li>Deploy it, or run it locally with those values.</li>
                </ol>
                <p className="mt-2 text-xs text-(--mws-muted)">This page checks every few seconds and updates by itself.</p>
                {stalled ? (
                  <p role="note" className="mt-3 rounded-lg border border-[#f3d7a3] bg-[#fff8e8] px-3 py-2 text-xs text-[#805b18]">
                    Still nothing after 10 minutes. Check that the application is deployed, that the token and base URL in its .env are
                    the ones from the connection, and that it calls Central on start.
                  </p>
                ) : null}
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setGuide(true)}>
                  Show Setup Guide
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {guide ? <SetupGuideDialog applicationId={applicationId} onClose={() => setGuide(false)} /> : null}
      {removing ? (
        <RemoveApplicationDialog
          applicationId={applicationId}
          onClose={() => setRemoving(false)}
          onRemoved={() => navigate(BACK)}
        />
      ) : null}
      {connection ? <ConnectDialog connection={connection} onClose={() => setConnection(null)} /> : null}
      {editing ? (
        <CrudDialog title="Edit Details" onClose={() => setEditing(false)}>
          <AppDetailsForm
            idLocked
            initial={setup.application}
            submitLabel="Save"
            submitting={updateMutation.isPending}
            onSubmit={(payload) => updateMutation.mutate(payload)}
            onCancel={() => setEditing(false)}
          />
        </CrudDialog>
      ) : null}
    </div>
  );
}
