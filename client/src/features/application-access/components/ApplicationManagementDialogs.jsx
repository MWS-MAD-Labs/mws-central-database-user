import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { oldTokenNotice } from "../../api-clients/utils/oldTokenNotice.js";
import { RotateTokenFlow } from "../../api-clients/components/RotateTokenFlow.jsx";
import { rotationSteps } from "../utils/setupGuide.js";
import { appGuideHref } from "../utils/startGuide.js";
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

// The Hub lines to add after switching to the code and token way, until Central has seen a code traded.
function SignInConnectDialog({ applicationId, ...props }) {
  const proof = useSignInProof(applicationId);
  return (
    <ConnectDialog
      {...props}
      proof={{ ...proof, waiting: "Waiting for the app to sign someone in with a Hub code. Open it from the Hub.", done: "The app signs in with a Hub code. You are done." }}
    />
  );
}

// Whether Central has seen the application sign in the way it was switched to.
function useSignInProof(applicationId) {
  const query = useQuery({
    queryKey: ["application-access", "setup", applicationId, "sign-in-proof"],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    refetchInterval: (state) => {
      const check = state.state.data?.session_check;
      return check?.confirmed_at || check?.known === false ? false : 5000;
    },
  });
  const check = query.data?.session_check;
  return { used: Boolean(check?.confirmed_at), unknown: check?.known === false };
}

// The lines to drop from the .env. It is done when Central has seen the application sign in the new way.
function RemoveLinesDialog({ applicationId, name, keys, onClose }) {
  const proof = useSignInProof(applicationId);
  const [leaving, setLeaving] = useState(false);
  const done = proof.used || proof.unknown;
  function requestClose() {
    if (done) onClose();
    else setLeaving(true);
  }
  return (
    <CrudDialog title="Remove From .env" description={`In the .env of ${name}, delete:`} onClose={requestClose}>
      <ul className="space-y-1 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 py-3 font-mono text-xs text-(--mws-charcoal)">
        {keys.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-(--mws-muted)">Your Central token stays the same.</p>
      <p className="mt-3 text-sm text-(--mws-charcoal)">
        {proof.used
          ? "The app reads the Hub session. You are done."
          : proof.unknown
            ? "Cannot check right now. Close this when the app is deployed."
            : "Waiting for the app to read the Hub session. Open it from the Hub."}
      </p>
      {leaving ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <p className="text-(--mws-muted)">
            <span className="font-semibold text-(--mws-charcoal)">Not in use yet.</span> The lines to remove are not shown again.
          </p>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <button type="button" className="cursor-pointer text-(--mws-muted) hover:text-(--mws-charcoal)" onClick={() => setLeaving(false)}>
              Keep Open
            </button>
            <button type="button" className="cursor-pointer text-[#a43c41] hover:underline" onClick={onClose}>
              Close Anyway
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button type="button" disabled={!done} onClick={onClose}>Done</Button>
      </div>
    </CrudDialog>
  );
}

// The dialogs that open from useApplicationManagement, the same on the setup steps and on Settings.
export function ApplicationManagementDialogs({ applicationId, setup, mgmt }) {
  const rotateGuide = appGuideHref(applicationId, "rotate");
  const rotationHelp = rotationSteps({ keys: setup.env_keys ?? [], environment: setup.environment });
  return (
    <>
      {mgmt.rotating ? (
        <RotateTokenFlow
          title={mgmt.rotating === "all" ? `${setup.application.name}, token and Hub secret` : setup.application.name}
          rotate={async (options) => {
            // Rotate Everything makes the new Hub secret first, so the lines that follow carry it.
            if (mgmt.rotating === "all") await applicationAccessApi.setHubAppSecret(applicationId, "rotate");
            return applicationAccessApi.rotateConnection(applicationId, options);
          }}
          onRotated={mgmt.refresh}
          renderResult={({ client, rotation, onClose }) => (
            <RotatedConnectDialog
              applicationId={applicationId}
              title="Rotated Credentials"
              description="Put these lines in the .env of the application, then deploy it."
              connection={{ env: client.env, hub_lines_missing: client.hub_lines_missing }}
              notice={oldTokenNotice(client, rotation)}
              nextSteps={{ items: rotationHelp.short, href: rotateGuide }}
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
        <SignInConnectDialog
          applicationId={applicationId}
          title="Add To .env"
          description={`Add these to the .env of ${setup.application.name}. Your Central token stays the same.`}
          onceLabel="Secret Shown Once"
          connection={{ env: mgmt.envChanges.add }}
          onClose={() => mgmt.setEnvChanges(null)}
        />
      ) : null}
      {mgmt.envChanges?.remove.length ? (
        <RemoveLinesDialog applicationId={applicationId} name={setup.application.name} keys={mgmt.envChanges.remove} onClose={() => mgmt.setEnvChanges(null)} />
      ) : null}
      {mgmt.connection ? <ConnectDialog connection={mgmt.connection} onClose={() => mgmt.setConnection(null)} /> : null}
      {mgmt.appSecret ? (
        <HubSecretShownDialog
          secret={mgmt.appSecret}
          applicationName={setup.application.name}
          nextSteps={{ items: rotationHelp.appSecret.slice(1), href: rotateGuide }}
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
