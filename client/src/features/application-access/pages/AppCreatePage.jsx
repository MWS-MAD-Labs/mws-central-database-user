import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { AppDetailsForm } from "../components/AppDetailsForm.jsx";
import { ConnectDialog } from "../components/ConnectDialog.jsx";
import { canManageApplications } from "../utils/canManageApplications.js";
import { startGuideHref } from "../utils/startGuide.js";

const BACK = "/application-access";

// Step 1 of the setup. The steps after it live on the setup page.
export function AppCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [created, setCreated] = useState(null);
  // The Hub's key lines, kept here from the wizard to the dialog at the end. They are not part of the request.
  const keyEnv = useRef(null);

  // Only one Hub can exist, so the choice goes away once there is one.
  const hubQuery = useQuery({
    queryKey: ["application-access", "hub-exists"],
    queryFn: () => applicationAccessApi.listApplications({ search: "hub", size: 20 }),
    enabled: canManageApplications(user),
  });
  const hubExists = Boolean(hubQuery.data?.data?.some((row) => row.is_hub));
  const contextQuery = useQuery({
    queryKey: ["application-access", "context"],
    queryFn: () => applicationAccessApi.context(),
    enabled: canManageApplications(user),
  });

  const mutation = useMutation({
    mutationFn: (payload) => applicationAccessApi.createApplication(payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Application added.");
      // The token is shown once, so the next page waits until the .env values are copied.
      if (response.connection) {
        const keyLines = (keyEnv.current ?? []).map((item) => ({ ...item, group: -1 }));
        setCreated(keyLines.length ? { ...response, connection: { ...response.connection, env: [...keyLines, ...response.connection.env] } } : response);
      }
      else navigate(`/application-access/apps/${response.application_id}/setup`);
    },
    onError: (error) => showErrorToast(error, "Could not add this application."),
  });

  if (!canManageApplications(user)) {
    return (
      <div className="min-w-0">
        <PageHeader title="Add Application" />
        <PanelMessage>Only a protected Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Add Application"
        description="Tell the Hub how to show this application and pick what it may read from Central. Its .env values come right after."
        actions={
          <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
              <Link to={BACK}><ArrowLeft size={16} /></Link>
            </Button>
        }
      />
      {created ? (
        <PanelMessage>Application added. Copy the lines, then you go to its setup.</PanelMessage>
      ) : (
        <div role="note" className="mb-4 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-4 text-sm text-(--mws-muted)">
          <p className="font-semibold text-(--mws-charcoal)">{hubQuery.isSuccess && !hubExists ? "Add The Hub First" : "Before You Add It"}</p>
          <p className="mt-1">
            {hubQuery.isSuccess && !hubExists
              ? "No Hub has been added yet, and every application is given its address. Add the Hub below. It starts with its signing key."
              : "Have the application's environment ready on its server. The token is shown only once, right after you add it."}{" "}
            <Link to={startGuideHref(hubQuery.isSuccess && !hubExists ? "hub" : "app")} className="font-semibold text-(--mws-burgundy) underline">
              Open The Guide
            </Link>
          </p>
        </div>
      )}
      {hubQuery.isPending && !created ? <PanelMessage>Checking for the Hub…</PanelMessage> : null}
      {hubQuery.isPending || created ? null : <AppDetailsForm
        layout="page"
        adminEmail={user?.email ?? ""}
        submitLabel="Add Application"
        hubExists={hubExists}
        hubKnown={hubQuery.isSuccess}
        hubAddress={contextQuery.data?.hub_address ?? ""}
        suggestedHubUrl={contextQuery.data?.suggested_hub_url ?? ""}
        deploymentEnvironment={contextQuery.data?.environment ?? ""}
        submitting={mutation.isPending}
        onSubmit={async (payload, extra) => {
          if (payload.is_hub) {
            const confirmed = await confirm({
              title: "Add the Hub",
              description:
                "There is only one Hub and it stays named HUB. It can only be removed after every other application.",
              confirmLabel: "Add Hub",
            });
            if (!confirmed) return;
          }
          keyEnv.current = extra?.keyEnv ?? null;
          mutation.mutate(payload);
        }}
        onCancel={() => navigate(BACK)}
      />}
      {created ? (
        <ConnectDialog
          connection={created.connection}
          onClose={() => navigate(`/application-access/apps/${created.application_id}/setup`)}
        />
      ) : null}
    </div>
  );
}
