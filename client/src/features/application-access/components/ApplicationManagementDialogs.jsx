import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { oldTokenNotice } from "../../api-clients/utils/oldTokenNotice.js";
import { RotateTokenFlow } from "../../api-clients/components/RotateTokenFlow.jsx";
import { rotationSteps } from "../utils/setupGuide.js";
import { AppDetailsForm } from "./AppDetailsForm.jsx";
import { ConnectDialog } from "./ConnectDialog.jsx";
import { DataAccessDialog } from "./DataAccessDialog.jsx";
import { HubSecretShownDialog } from "./HubSecretControls.jsx";
import { RemovalGuideDialog } from "./RemovalGuideDialog.jsx";
import { RemoveApplicationDialog } from "./RemoveApplicationDialog.jsx";

const BACK = "/application-access";

// The new token, shown until Central sees the application call with it.
function RotatedConnectDialog({ applicationId, ...props }) {
  const query = useQuery({
    queryKey: ["application-access", "setup", applicationId, "rotation"],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    refetchInterval: (state) => (state.state.data?.connection.newest_token_used_at ? false : 5000),
  });
  return <ConnectDialog {...props} proof={{ used: Boolean(query.data?.connection.newest_token_used_at) }} />;
}

// The lines to drop from the .env, closed only once the person says it is done.
function RemoveLinesDialog({ name, keys, onClose }) {
  return (
    <CrudDialog title="Remove From .env" description={`In the .env of ${name}, delete:`} onClose={onClose}>
      <ul className="space-y-1 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 py-3 font-mono text-xs text-(--mws-charcoal)">
        {keys.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-(--mws-muted)">Your Central token stays the same. The Hub picks up the change within a minute. Redeploy the application with the matching code.</p>
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={onClose}>Done</Button>
      </div>
    </CrudDialog>
  );
}

// The dialogs that open from useApplicationManagement, the same on the setup steps and on Settings.
export function ApplicationManagementDialogs({ applicationId, setup, mgmt }) {
  const guideBase = `/application-access/apps/${applicationId}/guide`;
  const rotationHelp = rotationSteps({ keys: setup.env_keys ?? [], environment: setup.environment });
  return (
    <>
      {mgmt.rotating ? (
        <RotateTokenFlow
          title={setup.application.name}
          rotate={(options) => applicationAccessApi.rotateConnection(applicationId, options)}
          onRotated={mgmt.refresh}
          renderResult={({ client, rotation, onClose }) => (
            <RotatedConnectDialog
              applicationId={applicationId}
              title="Rotated Credentials"
              description="Put these lines in the .env of the application, then deploy it."
              connection={{ env: client.env, hub_lines_missing: client.hub_lines_missing }}
              notice={oldTokenNotice(client, rotation)}
              nextSteps={{ items: rotationHelp.short, href: `${guideBase}?part=rotate` }}
              onClose={onClose}
            />
          )}
          onClose={() => mgmt.setRotating(false)}
        />
      ) : null}
      {mgmt.dataAccess ? (
        <DataAccessDialog applicationId={applicationId} current={setup.data_access.scope_names} onClose={() => mgmt.setDataAccess(false)} />
      ) : null}
      {mgmt.removalGuide ? <RemovalGuideDialog onClose={() => mgmt.setRemovalGuide(false)} /> : null}
      {mgmt.removing ? (
        <RemoveApplicationDialog applicationId={applicationId} onClose={() => mgmt.setRemoving(false)} onRemoved={() => mgmt.navigate(BACK)} />
      ) : null}
      {mgmt.envChanges?.add.length ? (
        <ConnectDialog
          title="Add To .env"
          description={`Add these to the .env of ${setup.application.name}. Your Central token stays the same. The Hub picks up the change within a minute. Redeploy the application with the matching code.`}
          onceLabel="Secret Shown Once"
          connection={{ env: mgmt.envChanges.add }}
          onClose={() => mgmt.setEnvChanges(null)}
        />
      ) : null}
      {mgmt.envChanges?.remove.length ? (
        <RemoveLinesDialog name={setup.application.name} keys={mgmt.envChanges.remove} onClose={() => mgmt.setEnvChanges(null)} />
      ) : null}
      {mgmt.connection ? <ConnectDialog connection={mgmt.connection} onClose={() => mgmt.setConnection(null)} /> : null}
      {mgmt.appSecret ? (
        <HubSecretShownDialog
          secret={mgmt.appSecret}
          applicationName={setup.application.name}
          nextSteps={{ items: rotationHelp.appSecret.slice(1), href: `${guideBase}?part=rotate` }}
          onClose={() => mgmt.setAppSecret(null)}
        />
      ) : null}
      {mgmt.editing ? (
        <CrudDialog title="Edit Details" onClose={() => mgmt.setEditing(false)}>
          <AppDetailsForm
            idLocked
            isHub={setup.is_hub}
            initial={setup.application}
            submitLabel="Save"
            submitting={mgmt.updateMutation.isPending}
            onSubmit={(payload) => mgmt.updateMutation.mutate(payload)}
            onCancel={() => mgmt.setEditing(false)}
          />
        </CrudDialog>
      ) : null}
    </>
  );
}
