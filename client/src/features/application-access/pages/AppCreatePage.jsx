import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { AppDetailsForm } from "../components/AppDetailsForm.jsx";

const BACK = "/application-access";

// Step 1 of the setup. The steps after it live on the setup page.
export function AppCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload) => applicationAccessApi.createApplication(payload),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Application added.");
      navigate(`/application-access/apps/${created.application_id}/setup`);
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
        description="Step 1 of 6. Tell the Hub how to show this application. Next you connect it, add roles and a group, and publish it."
        actions={
          <Button asChild variant="secondary">
            <Link to={BACK}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <div className="max-w-2xl rounded-2xl border border-(--mws-line) bg-white p-5">
        <AppDetailsForm
          submitLabel="Add Application"
          submitting={mutation.isPending}
          onSubmit={(payload) => mutation.mutate(payload)}
          onCancel={() => navigate(BACK)}
        />
      </div>
    </div>
  );
}
