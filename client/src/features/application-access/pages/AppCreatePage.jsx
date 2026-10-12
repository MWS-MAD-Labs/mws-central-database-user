import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

const BACK = "/application-access";

// Step 1 of the setup. The steps after it live on the setup page.
export function AppCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [created, setCreated] = useState(null);

  // Only one Hub can exist, so the choice goes away once there is one.
  const hubQuery = useQuery({
    queryKey: ["application-access", "hub-exists"],
    queryFn: () => applicationAccessApi.listApplications({ search: "hub", size: 20 }),
    enabled: user?.role === "SUPER_ADMIN",
  });
  const hubExists = Boolean(hubQuery.data?.data?.some((row) => row.is_hub));

  const mutation = useMutation({
    mutationFn: (payload) => applicationAccessApi.createApplication(payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Application added.");
      // The token is shown once, so the next page waits until the .env values are copied.
      if (response.connection) setCreated(response);
      else navigate(`/application-access/apps/${response.application_id}/setup`);
    },
    onError: (error) => showErrorToast(error, "Could not add this application."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add Application" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Add Application"
        description="Tell the Hub how to show this application and pick what it may read from Central. Its .env values come right after."
        actions={
          <Button asChild variant="secondary">
              <Link to={BACK}>
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
        }
      />
      <AppDetailsForm
        layout="page"
        adminEmail={user?.email ?? ""}
        submitLabel="Add Application"
        hubExists={hubExists}
        submitting={mutation.isPending}
        onSubmit={async (payload) => {
          if (payload.is_hub) {
            const confirmed = await confirm({
              title: "Add the Hub",
              description:
                "The Hub cannot be retired, deleted or renamed once it is added, and there can only be one. Add it only for the real Hub.",
              confirmLabel: "Add Hub",
            });
            if (!confirmed) return;
          }
          mutation.mutate(payload);
        }}
        onCancel={() => navigate(BACK)}
      />
      {created ? (
        <ConnectDialog
          connection={created.connection}
          onClose={() => navigate(`/application-access/apps/${created.application_id}/setup`)}
        />
      ) : null}
    </div>
  );
}
