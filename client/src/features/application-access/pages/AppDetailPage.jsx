import { appGuideHref } from "../utils/startGuide.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, BookOpen, Pencil, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { ToggleSwitch } from "../../../components/ui/FormControls.jsx";
import { NameList } from "../../../components/ui/NameList.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { formatDate, formatDateTime } from "../../../lib/format.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { AppAccessSection } from "../components/AppAccessSection.jsx";
import { AppCardPreview } from "../components/AppCardPreview.jsx";
import { ApplicationManagementDialogs } from "../components/ApplicationManagementDialogs.jsx";
import { AppStatusStrip } from "../components/AppStatusStrip.jsx";
import { SignInGuide } from "../components/SignInGuide.jsx";
import { AppActivityTab } from "../components/AppActivityTab.jsx";
import { CopyableId } from "../components/CopyableId.jsx";
import { AddressLink } from "../components/AddressLink.jsx";
import { DifferentDomainNote } from "../components/DifferentDomainNote.jsx";
import { OrganizationCheck } from "../components/OrganizationCheck.jsx";
import { HubSettingsCard } from "../components/HubSettingsCard.jsx";
import { useApplicationManagement } from "../hooks/useApplicationManagement.js";
import { useCheckNow } from "../hooks/useCheckNow.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { nameOf, useApplicationTaxonomy } from "../hooks/useApplicationTaxonomy.js";
import { useInternalEndpoints } from "../hooks/useInternalEndpoints.js";
import { buildSteps, stepsDone, timeAgo } from "../utils/setupSteps.js";
import { titleCase } from "../utils/roleLabel.js";
import { appHomeUrl, sameParentDomain } from "../utils/sessionDomain.js";
import { computeDateRange } from "../../../lib/dateRange.js";
import { canManageApplications } from "../utils/canManageApplications.js";

const CARD_STATUS_LABEL = { active: "Active", maintenance: "Maintenance", coming_soon: "Coming Soon", new: "New" };

function Rows({ rows }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-(--mws-muted)">{label}</dt>
          <dd className="min-w-0 break-words text-(--mws-charcoal)">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A few figures at a glance: the figure large, what it counts small under it.
function Stats({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-(--mws-soft) px-4 py-3">
          <dd className="font-display text-xl font-bold leading-tight text-(--mws-charcoal)">{value}</dd>
          <dt className="mt-0.5 text-xs text-(--mws-muted)">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

const mono = (value) => <span className="font-mono text-xs">{value}</span>;

// What can still change once an application is set up, and what is known about it. A summary on top and a tab for each
// kind of thing. There is one way to edit the details (the button in the header), the tabs only show.
const HEALTH_LABEL = {
  healthy: "Healthy",
  pending: "Not Connected Yet",
  check_token: "Check Token",
  token_pending: "Update Pending",
  sign_in_pending: "Update Pending",
  unreachable: "Unreachable",
  wrong_path: "Wrong Path",
};
const ALERT_HEALTH = ["check_token", "token_pending", "sign_in_pending", "unreachable", "wrong_path"];

export function AppDetailPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const superAdmin = canManageApplications(user);
  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: superAdmin,
  });
  const [activityPage, setActivityPage] = useState(1);
  const [activitySize, setActivitySize] = useState(10);
  const [activityRange, setActivityRange] = useState({ preset: "this_month", ...computeDateRange("this_month") });
  const settingsQuery = useQuery({
    queryKey: ["application-access", "settings", applicationId, activityPage, activitySize, activityRange.date_from, activityRange.date_to],
    queryFn: () =>
      applicationAccessApi.getSettings(applicationId, {
        page: activityPage,
        size: activitySize,
        dateFrom: activityRange.date_from ? `${activityRange.date_from}T00:00:00.000` : undefined,
        dateTo: activityRange.date_to ? `${activityRange.date_to}T23:59:59.999` : undefined,
      }),
    enabled: superAdmin,
    placeholderData: keepPreviousData,
  });
  const detailQuery = useQuery({
    queryKey: ["application-access", "app", applicationId],
    queryFn: () => applicationAccessApi.getApplication(applicationId),
    enabled: superAdmin,
  });
  const roles = (useApplicationRoles().data || []).filter((role) => role.application_id === applicationId);
  const hasActiveRole = roles.some((role) => role.is_active);
  const mgmt = useApplicationManagement(applicationId, setupQuery.data);
  const checkNow = useCheckNow();
  const { countFor, loaded: endpointsLoaded } = useInternalEndpoints();
  const taxonomy = useApplicationTaxonomy();
  const base = `/application-access/apps/${applicationId}`;

  if (!superAdmin) {
    return (
      <div className="min-w-0">
        <PageHeader title={applicationId} />
        <PanelMessage>Only a protected Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (setupQuery.isLoading || settingsQuery.isLoading || detailQuery.isLoading) return <PanelMessage>Loading {applicationId}…</PanelMessage>;
  if (setupQuery.isError || !setupQuery.data || detailQuery.isError || !detailQuery.data) return <PanelMessage tone="error">This application could not be found.</PanelMessage>;

  const setup = setupQuery.data;
  const more = settingsQuery.data;
  const health = setup.health;
  const steps = buildSteps(setup);
  // An application that was never finished still has its steps to do. Until then only the access tabs are shown.
  const unfinished = !setup.setup_completed && stepsDone(steps) < steps.length;

  const app = setup.application;
  const retired = Boolean(app.retired_at);
  const link = app.launch_mode === "link";
  const endpointCount = countFor(setup.data_access.scope_names);
  const { setEditing, setRotating, setDataAccess, setRemoving, setRemovalGuide, restoreMutation, publishMutation, connectMutation, appSecretMutation, sessionModeMutation, retire, changeAppSecret, changeSessionMode, changePublished } = mgmt;
  const canShow = setup.can_publish && Boolean(app.launch_url);
  // An application on the shared session whose address is not under the Hub's parent domain.
  const sharedHere = app.launch_mode === "sso" && app.uses_hub && !setup.hub && app.session_mode === "shared";
  const differentDomain = sharedHere && sameParentDomain(setup.hub_address, app.launch_url) === false;

  const tabs = [
    { id: "access", label: "Access" },
    { id: "roles", label: "Roles" },
    ...(link ? [] : [{ id: "permissions", label: "Permissions" }]),
    ...(unfinished ? [] : [{ id: "overview", label: "Overview" }]),
    ...(unfinished ? [] : setup.is_hub ? [{ id: "hub", label: "Hub Sign-in" }] : []),
    ...(unfinished || link ? [] : [{ id: "connection", label: "Connection" }]),
    ...(unfinished || setup.is_hub ? [] : [{ id: "card", label: "Hub Card" }]),
    ...(unfinished ? [] : [{ id: "activity", label: "Activity" }]),
  ];
  const wanted = params.get("tab");
  const active = tabs.some((tab) => tab.id === wanted) ? wanted : "access";

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={app.name}
        description={app.application_id}
        actions={
          <>
            <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
              <Link to={base}><ArrowLeft size={16} /></Link>
            </Button>
            <Button asChild variant="secondary" size="icon" aria-label="Setup Guide" title="Setup Guide">
              <Link to={appGuideHref(applicationId, "local")}><BookOpen size={16} /></Link>
            </Button>
            {active === "access" && !retired ? (
              <Button
                type="button"
                disabled={!hasActiveRole}
                title={hasActiveRole ? "Add Group" : "Add a role first"}
                onClick={() => navigate(`${base}/groups/new`)}
                size="icon"
                aria-label="Add Group"
              >
                <Plus size={16} />
              </Button>
            ) : null}
            {retired || setup.is_hub || link ? null : (
              <Button type="button" variant="secondary" size="icon" aria-label="Check Now" title="Check Now" disabled={checkNow.isPending} onClick={() => checkNow.mutate(applicationId)}>
                <RefreshCw size={16} />
              </Button>
            )}
            {retired ? null : (
              <Button type="button" size="icon" aria-label="Edit Details" title="Edit Details" onClick={() => setEditing(true)}>
                <Pencil size={16} />
              </Button>
            )}
            {setup.is_hub && !retired && !setup.removal.retire_available && !setup.removal.can_remove ? null : (
              <ActionsMenu label="More actions">
                {(closeMenu) => (
                  <>
                    <ActionsMenuItem
                      onClick={() => {
                        closeMenu();
                        setRemovalGuide(true);
                      }}
                    >
                      How Removing Works
                    </ActionsMenuItem>
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
              </ActionsMenu>
            )}
          </>
        }
      />

      {retired ? (
        <div role="note" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#e3a2a5] bg-[#fff0f1] px-5 py-3 text-sm text-[#a43c41]">
          <span className="font-semibold">Retired</span>
          <span>Its token is revoked, it is hidden from the Hub and nobody has access. Nothing was deleted.</span>
          <span className="ml-auto flex gap-4">
            <TextAction onClick={() => restoreMutation.mutate()}>Restore</TextAction>
            <TextAction onClick={() => setRemoving(true)}>Delete</TextAction>
          </span>
        </div>
      ) : null}

      {unfinished ? (
        <div role="note" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#d8b45b] bg-[#fff8e8] px-5 py-3 text-sm text-[#745716]">
          <span className="font-semibold">
            Finish setup ({stepsDone(steps)} of {steps.length})
          </span>
          <span>{setup.is_hub ? "Some setup steps are still open." : "This application does not show in the Hub yet."}</span>
          <Link to={appGuideHref(applicationId)} className="ml-auto text-xs font-medium text-(--mws-muted) hover:text-(--mws-charcoal) hover:underline">
            Setup Guide
          </Link>
          <Button asChild variant="secondary" size="sm">
            <Link to={`${base}/setup`}>Continue Setup</Link>
          </Button>
        </div>
      ) : null}

      {!retired && ALERT_HEALTH.includes(health?.status) ? (
        <div role="note" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#d8b45b] bg-[#fff8e8] px-5 py-3 text-sm text-[#745716]">
          <span className="font-semibold">{HEALTH_LABEL[health.status]}</span>
          <span>
            {health.status === "check_token"
              ? `Still calling with an old token, last seen ${timeAgo(health.since)} ago. Give the app the newest token.`
              : health.status === "token_pending"
                ? health.detail.startsWith("Waiting")
                  ? `${health.detail} ${formatDateTime(health.since)}. Give the app the newest token before then.`
                  : `${health.detail}. Give it the newest token.`
                : health.status === "sign_in_pending"
                  ? `${health.detail}. Open the app from the Hub to check. Changed ${timeAgo(health.since)} ago.`
                  : health.status === "wrong_path"
                    ? `Something answers at the address, but the sign-in page was not found${health.since ? ` since ${formatDateTime(health.since)}` : ""}. Fix the Sign-In Address in Edit Details.`
                    : `Not answering at its address${health.since ? ` since ${formatDateTime(health.since)}` : ""}. Check the app in Komodo.`}
          </span>
          {health.status === "check_token" || health.status === "token_pending" ? (
            <span className="ml-auto">
              <TextAction asChild>
                <Link to={appGuideHref(applicationId, "rotate")}>Rotation Guide</Link>
              </TextAction>
            </span>
          ) : null}
        </div>
      ) : null}

      <AppStatusStrip
        hubStatus={retired ? { tone: "red", label: "Retired" } : setup.is_hub ? { tone: "neutral", label: "Hub" } : { tone: app.published ? "green" : "amber", label: app.published ? "Shown in the Hub" : "Hidden from the Hub" }}
        link={link}
        health={health}
        connection={setup.connection}
        access={more?.access}
        createdAt={more?.created_at}
        groupsPath={base}
      />

      <Tabs label="Application" tabs={tabs} active={active} onChange={(id) => setParams({ tab: id })} />

      {active === "access" || active === "roles" || active === "permissions" ? (
        <>
          {active === "access" ? (
            <Stats
              items={[
                ["Active Groups", more?.access.groups ?? setup.groups.active_count],
                ["People Reached", more ? more.access.people : "-"],
                ["Exceptions", more ? more.access.exceptions : "-"],
                ["Blocked", more ? more.access.blocked : "-"],
              ]}
            />
          ) : null}
          <AppAccessSection applicationId={applicationId} detail={detailQuery.data} roles={roles} tab={active} />
        </>
      ) : (
      <section className="rounded-2xl border border-(--mws-line) bg-white p-5">
        {active === "overview" ? (
          <Rows
            rows={[
              ["Name", app.name],
              ["Application ID", mono(app.application_id)],
              ["Organization ID", (
                <div key="org" className="space-y-1">
                  <CopyableId value={setup.organization_id} />
                  <p className="text-xs"><OrganizationCheck organization={setup.organization} /></p>
                </div>
              )],
              ...(setup.is_hub
                ? (setup.hub?.base_url ? [["Address", <AddressLink key="addr" url={setup.hub.base_url} />]] : [])
                : [["Address", app.launch_url ? <AddressLink key="addr" url={appHomeUrl(app.launch_url)} /> : "Not set"]]),
              ...(setup.is_hub || link || !app.launch_url ? [] : [["Sign-In Address", mono(app.launch_url)]]),
              ...(setup.is_hub || link ? [] : [["Logout Address", mono(app.logout_url || "None")]]),
              ...(setup.is_hub ? [] : [["Opens As", link ? "Plain Link" : "Single Sign-On"]]),
              ...(health ? [["Health", HEALTH_LABEL[health.status]]] : []),
              ...(app.category ? [["Category", nameOf(taxonomy.categories, app.category) || app.category]] : []),
              ...(app.scope ? [["Scope", nameOf(taxonomy.scopes, app.scope) || app.scope]] : []),
              ...(more ? [["Created", formatDateTime(more.created_at)], ["Last Updated", `${formatDateTime(more.updated_at)}${more.activity[0]?.by ? ` by ${more.activity[0].by}` : ""}`]] : []),
            ]}
          />
        ) : null}

        {active === "overview" && !link && setup.connection.created && !retired ? (
          <div className="mt-4 border-t border-(--mws-line) pt-4">
            <TextAction onClick={() => setParams({ tab: "connection" })}>Rotate Credentials</TextAction>
          </div>
        ) : null}

        {active === "hub" && setup.env_settings ? <HubSettingsCard settings={setup.env_settings} hub={setup.hub} applicationId={applicationId} sharedApps={setup.shared_apps ?? []} /> : null}

        {active === "connection" ? (
          <div className="space-y-4">
            <Stats
              items={[
                ["Permissions", setup.permissions.count],
                ["Scopes", setup.data_access.scope_names.length],
                ...(endpointsLoaded ? [["Endpoints", endpointCount]] : []),
                ["Last Call", setup.connection.last_used_at ? `${timeAgo(setup.connection.last_used_at)} Ago` : "Never"],
              ]}
            />
            <Rows
              rows={[
                ["Token", more?.token ? `Made ${formatDate(more.token.created_at)}` : "None Yet"],
                ["Environment", more?.token?.environment ? titleCase(more.token.environment.toLowerCase()) : setup.environment ? titleCase(setup.environment) : "-"],
                ["Organization ID Sent", <OrganizationCheck key="orgcheck" organization={setup.organization} />],
                ["Permissions Received", setup.permissions.synced_at ? `${formatDateTime(setup.permissions.synced_at)} (${timeAgo(setup.permissions.synced_at)} Ago)` : "Not yet"],
                ["Data Access", <NameList key="d" names={setup.data_access.scope_names} noun="Scopes" title="Data access scopes" plain="None" />],
                ...(setup.application.launch_mode === "sso" && setup.application.uses_hub && !setup.hub
                  ? [["Sign-In Way", setup.application.session_mode === "shared" ? `Shared Hub Session${differentDomain ? " (Different Domain)" : ""}` : "Hub Code & Token (Legacy)"]]
                  : []),
                ...(setup.hub_secret?.applies ? [["Hub Secret", setup.hub_secret.mode === "own" ? `Dedicated, Version ${setup.hub_secret.version}` : "Shared With Other Apps"]] : []),
                ["Reads From .env", mono((setup.env_keys ?? []).map((item) => item.key).join(", ") || "-")],
              ]}
            />
            {differentDomain ? <DifferentDomainNote hubAddress={setup.hub_address} appAddress={app.launch_url} /> : null}
            {setup.application.launch_mode === "sso" && setup.application.uses_hub && !setup.hub ? (
              <SignInGuide mode={setup.application.session_mode === "shared" ? "shared" : "relay"} />
            ) : null}
            {retired ? null : setup.connection.created ? (
              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-(--mws-line) pt-4">
                <TextAction onClick={() => setRotating(true)}>Rotate Token</TextAction>
                {setup.hub_secret?.applies && setup.hub_secret.mode === "own" ? (
                  <TextAction onClick={() => setRotating("all")}>Rotate Everything</TextAction>
                ) : null}
                {setup.hub_secret?.applies ? (
                  <TextAction loading={appSecretMutation.isPending} onClick={changeAppSecret}>
                    {setup.hub_secret.mode === "own" ? "Rotate Hub Secret" : "Give A Dedicated Hub Secret"}
                  </TextAction>
                ) : null}
                {setup.application.launch_mode === "sso" && setup.application.uses_hub && !setup.hub ? (
                  <TextAction loading={sessionModeMutation.isPending} onClick={changeSessionMode}>Change Sign-In Way</TextAction>
                ) : null}
                {endpointsLoaded && setup.data_access.editable ? <TextAction onClick={() => setDataAccess(true)}>Change Data Access</TextAction> : null}
                <TextAction asChild>
                  <Link to={appGuideHref(applicationId, "rotate")}>Rotation Guide</Link>
                </TextAction>
              </div>
            ) : (
              <div className="border-t border-(--mws-line) pt-4">
                <TextAction loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
                  Create Connection
                </TextAction>
              </div>
            )}
          </div>
        ) : null}

        {active === "card" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-4">
              <Stats
                items={[
                  ["In The Hub", app.published ? "Shown" : "Hidden"],
                  ["Status", CARD_STATUS_LABEL[app.hub_status] ?? "Active"],
                  ["Keywords", (app.hub_keywords ?? []).length],
                ]}
              />
              <Rows
                rows={[
                  ["Keywords", (app.hub_keywords ?? []).length > 0 ? app.hub_keywords.join(", ") : "None"],
                  ...(app.published || canShow ? [] : [["Before It Can Show", "Finish the groups and the address first"]]),
                ]}
              />
              <div className="flex flex-wrap items-center gap-3 border-t border-(--mws-line) pt-4">
                <ToggleSwitch checked={app.published} disabled={retired || publishMutation.isPending || (!app.published && !canShow)} onChange={changePublished}>
                  {app.published ? "Shown In Hub" : "Hidden From Hub"}
                </ToggleSwitch>
                <span className="text-xs text-(--mws-muted)">Status and keywords are changed with Edit Details.</span>
              </div>
            </div>
            <AppCardPreview
              values={{ ...app, category_name: nameOf(taxonomy.categories, app.category), scope_name: nameOf(taxonomy.scopes, app.scope) }}
            />
          </div>
        ) : null}

        {active === "activity" ? (
          <AppActivityTab
            data={more}
            range={activityRange}
            isDefaultRange={activityRange.preset === "this_month"}
            isFetching={settingsQuery.isFetching}
            onRangeChange={(next) => {
              setActivityRange(next);
              setActivityPage(1);
            }}
            onReset={() => {
              setActivityRange({ preset: "this_month", ...computeDateRange("this_month") });
              setActivityPage(1);
            }}
            onPage={setActivityPage}
            onPageSize={(next) => {
              setActivitySize(next);
              setActivityPage(1);
            }}
          />
        ) : null}
      </section>
      )}

      {setup.is_hub ? (
        <div role="note" className="flex items-center gap-3 rounded-2xl border border-[#d9a9ac] bg-[#7E15180D] px-5 py-3 text-sm text-(--mws-burgundy)">
          <ShieldCheck size={18} aria-hidden="true" className="shrink-0" />
          <span>
            <span className="font-semibold">This is the Hub itself.</span> Every other application signs in through it.
          </span>
        </div>
      ) : null}

      <ApplicationManagementDialogs applicationId={applicationId} setup={setup} mgmt={mgmt} />
    </div>
  );
}
