import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

const BACK = "/application-access";
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function AppCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [attempted, setAttempted] = useState(false);
  const valid = ID_PATTERN.test(applicationId.trim());

  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.createApplication(applicationId.trim()),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Application added.");
      navigate(`/application-access/apps/${created.application_id}?tab=roles`);
    },
    onError: (error) => showErrorToast(error, "Could not add this application."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add application" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Add application"
        description="Give it an id, then add its roles and groups. Its Organization ID is created for you."
        actions={
          <Button asChild variant="secondary">
            <Link to={BACK}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
        <Field
          label="Application ID"
          hint="Lowercase letters, numbers, hyphens and underscores, starting with a letter. For example exima."
          error={attempted && !valid ? "Use lowercase letters, numbers, hyphens or underscores, starting with a letter." : undefined}
        >
          <TextInput value={applicationId} onChange={(event) => setApplicationId(event.target.value.toLowerCase())} />
        </Field>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link to={BACK}>Cancel</Link>
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Add application
          </Button>
        </div>
      </form>
    </div>
  );
}
