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
            <ConnectDialog
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
          title="Add These .env Lines"
          description="The Central token stays the same, no rotation needed. Add these lines to the .env of the application, then deploy it."
          onceLabel="Secret Shown Once"
          connection={{ env: mgmt.envChanges.add }}
          onClose={() => mgmt.setEnvChanges(null)}
        />
      ) : null}
      {mgmt.envChanges?.remove.length ? (
        <CrudDialog
          title="Remove These .env Lines"
          description="The Central token stays the same, no rotation needed. The application no longer reads these lines, so they can be removed."
          onClose={() => mgmt.setEnvChanges(null)}
        >
          <ul className="space-y-1 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 py-3 font-mono text-xs text-(--mws-charcoal)">
            {mgmt.envChanges.remove.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={() => mgmt.setEnvChanges(null)}>Done</Button>
          </div>
        </CrudDialog>
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
