import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

// Everything a person can do to an application besides the steps: edit, connect, rotate, Hub secret, show or hide in
// the Hub, retire, restore and delete. Shared by the setup steps and the Settings page, with their dialogs in
// ApplicationManagementDialogs.
export function useApplicationManagement(applicationId, setup) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [connection, setConnection] = useState(null);
  // The .env lines to add or drop after the sign-in way changed. Shown once.
  const [envChanges, setEnvChanges] = useState(null);
  const [removing, setRemoving] = useState(false);
  // A Hub secret made for this application. Shown once.
  const [appSecret, setAppSecret] = useState(null);
  const [removalGuide, setRemovalGuide] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [dataAccess, setDataAccess] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["application-access"] });

  const appSecretMutation = useMutation({
    mutationFn: (action) => applicationAccessApi.setHubAppSecret(applicationId, action),
    onSuccess: (result) => {
      refresh();
      setAppSecret(result.secret);
    },
    onError: (error) => showErrorToast(error, "Could not make the Hub secret."),
  });
  const sessionModeMutation = useMutation({
    mutationFn: (sessionMode) => applicationAccessApi.updateDetails(applicationId, { session_mode: sessionMode }),
    onSuccess: (response) => {
      refresh();
      const changes = response?.env_changes;
      if (changes && (changes.add.length || changes.remove.length)) setEnvChanges(changes);
      showSuccessToast("Sign-in way changed.");
    },
    onError: (error) => showErrorToast(error, "Could not change the sign-in way."),
  });
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
  const retireMutation = useMutation({
    mutationFn: () => applicationAccessApi.retireApplication(applicationId),
    onSuccess: () => {
      refresh();
      showSuccessToast("Application retired.");
    },
    onError: (error) => showErrorToast(error, "Could not retire this application."),
  });
  const restoreMutation = useMutation({
    mutationFn: () => applicationAccessApi.restoreApplication(applicationId),
    onSuccess: () => {
      refresh();
      showSuccessToast("Application restored. Create a new connection to use it again.");
    },
    onError: (error) => showErrorToast(error, "Could not restore this application."),
  });
  const publishMutation = useMutation({
    mutationFn: (publish) => (publish ? applicationAccessApi.publish(applicationId) : applicationAccessApi.unpublish(applicationId)),
    onSuccess: (_data, publish) => {
      refresh();
      showSuccessToast(publish ? "The application will now show in the Hub." : "The application is hidden from the Hub.");
    },
    onError: (error) => showErrorToast(error, "Could not change this."),
  });

  async function retire() {
    const confirmed = await confirm({
      title: "Retire Application",
      description: `${setup.application.name} leaves the Hub and its token is revoked. Nothing is deleted, you can restore it.`,
      confirmLabel: "Retire",
      tone: "danger",
    });
    if (confirmed) retireMutation.mutate();
  }

  async function changeAppSecret() {
    const own = setup.hub_secret.mode === "own";
    const confirmed = await confirm({
      title: own ? "Rotate Hub Secret" : "Give A Dedicated Hub Secret",
      description: own
        ? `${setup.application.name} and the Hub cannot sign each other in until its .env has the new value.`
        : `${setup.application.name} gets a Hub secret of its own. Put it in its .env. Until then it keeps the Hub's secret.`,
      confirmLabel: own ? "Rotate" : "Give",
      tone: own ? "danger" : undefined,
    });
    if (confirmed) appSecretMutation.mutate(own ? "rotate" : "own");
  }

  async function changePublished(publish) {
    const name = setup.application.name;
    const confirmed = await confirm({
      title: publish ? `Show ${name} In The Hub` : `Hide ${name} From The Hub`,
      description: publish ? `People with access see ${name} in the Hub.` : `People no longer see ${name} in the Hub.`,
      confirmLabel: publish ? "Show" : "Hide",
      tone: publish ? undefined : "danger",
    });
    if (confirmed) publishMutation.mutate(publish);
  }

  // The other way round from what it is now. The application's code has to match, so this asks first.
  async function changeSessionMode() {
    const toShared = setup.application.session_mode !== "shared";
    const name = setup.application.name;
    const confirmed = await confirm({
      title: toShared ? "Switch To Shared Hub Session" : "Switch To Hub Code & Token (Legacy)",
      description: toShared
        ? `${name} will read the Hub session. Update its code first.`
        : `${name} will get a code and token from the Hub again. Update its code first.`,
      confirmLabel: toShared ? "Switch To Shared Session" : "Switch To Code & Token",
      tone: "danger",
    });
    if (confirmed) sessionModeMutation.mutate(toShared ? "shared" : "relay");
  }

  return {
    refresh,
    navigate,
    editing, setEditing,
    connection, setConnection,
    envChanges, setEnvChanges,
    removing, setRemoving,
    appSecret, setAppSecret,
    removalGuide, setRemovalGuide,
    rotating, setRotating,
    dataAccess, setDataAccess,
    appSecretMutation, sessionModeMutation, connectMutation, updateMutation, retireMutation, restoreMutation, publishMutation,
    retire,
    changeAppSecret,
    changeSessionMode,
    changePublished,
  };
}
