import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { SegmentedControl } from "../../../components/ui/SegmentedControl.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { GuideNav } from "../components/guide/GuideNav.jsx";
import { Paragraph, Steps } from "../components/guide/GuidePieces.jsx";
import { HowPart, HubPart, AppPart, SignInPart, CheckPart, ProblemsPart } from "../components/guide/parts/StartParts.jsx";
import { DeployPart, LocalPart, PermissionsPart, RotatePart, TroubleshootingPart } from "../components/guide/parts/AppParts.jsx";
import { canManageApplications } from "../utils/canManageApplications.js";
import { connectionKeys, githubEnvironmentOf, GITHUB_MODES } from "../utils/setupGuide.js";
import { ENVIRONMENT_NAMES } from "../utils/startGuide.js";
import { HUB_REMOVAL_NOTE, HUB_REMOVAL_NOTE_ID, REMOVAL_STEPS } from "../utils/removalGuide.js";
import { GUIDE_LANGUAGES, GuideLangContext, isGuideLang, useT } from "../utils/guideLang.js";

// Names a block of .env lines would use before an application is picked.
const GENERIC_KEYS = [
  { key: "HUB_SSO_APP_ID", secret: false },
  { key: "CENTRAL_API_BASE_URL", secret: false },
  { key: "CENTRAL_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
];

const PARTS = [
  { id: "how", label: "How it fits", label_id: "Gambaran umum" },
  { id: "hub", label: "Add the Hub first", label_id: "Tambahkan Hub terlebih dahulu" },
  { id: "app", label: "Add an application", label_id: "Tambahkan aplikasi" },
  { id: "signin", label: "Choose the sign-in way", label_id: "Pilih cara sign-in" },
  { id: "local", label: "On your machine", label_id: "Di lingkungan lokal" },
  { id: "permissions", label: "Send the permissions", label_id: "Kirim permission" },
  { id: "deploy", label: "Staging and production", label_id: "Staging dan production" },
  { id: "check", label: "Check it works", label_id: "Periksa hasilnya" },
  { id: "rotate", label: "When you rotate", label_id: "Rotasi" },
  { id: "remove", label: "Retire or remove", label_id: "Retire atau hapus" },
  { id: "problems", label: "When something fails", label_id: "Jika ada yang gagal" },
];

const LANG_KEY = "mws-guide-lang";

function savedLang() {
  try {
    const value = window.localStorage.getItem(LANG_KEY);
    return isGuideLang(value) ? value : "en";
  } catch {
    return "en";
  }
}

// Before an application is picked the guide talks about "your application" and leaves the values as placeholders.
const GENERIC_SETUP = {
  is_hub: false,
  application: { name: "your application" },
  central_url: "",
  hub_address: "",
  organization_id: "",
  env_keys: [],
  environment: "development",
};

function RemovePart() {
  const t = useT();
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "An application is taken out of use in this order. Stop first, delete after.",
          "Aplikasi dihentikan dengan urutan berikut: retire terlebih dahulu, baru hapus.",
        )}
      </Paragraph>
      <Steps items={REMOVAL_STEPS.map((step) => `${t(step.title, step.title_id)}. ${t(step.text, step.text_id)}`)} />
      <Paragraph>{`${t("The Hub itself", "Hub sendiri")}: ${t(HUB_REMOVAL_NOTE, HUB_REMOVAL_NOTE_ID)}`}</Paragraph>
    </div>
  );
}

// Every guide of Application Access in one place, from nothing to a rotation. Pick an application to see its own names and
// values; without one the text stays general.
export function GuidesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = canManageApplications(user);
  const applicationId = params.get("app") || "";
  const lang = isGuideLang(params.get("lang")) ? params.get("lang") : savedLang();
  const t = (en, id) => (lang === "id" ? id : en);
  const contextQuery = useQuery({
    queryKey: ["application-access", "context"],
    queryFn: () => applicationAccessApi.context(),
    enabled: allowed,
  });
  const appsQuery = useQuery({
    queryKey: ["application-access", "applications", "guide-picker"],
    queryFn: () => applicationAccessApi.listApplications({ size: 100 }),
    enabled: allowed,
  });
  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: allowed && Boolean(applicationId),
  });

  if (!allowed) {
    return (
      <div className="min-w-0">
        <PageHeader title="Guides" />
        <PanelMessage>{t("Only a protected Super Admin can manage application access.", "Hanya protected Super Admin yang dapat mengelola akses aplikasi.")}</PanelMessage>
      </div>
    );
  }

  if (applicationId && setupQuery.isLoading) return <PanelMessage>{t("Loading the guide…", "Memuat panduan…")}</PanelMessage>;

  const contextEnvironment = contextQuery.data?.environment ?? "";
  const hubUrl = contextQuery.data?.suggested_hub_url ?? "";
  const setup = applicationId && setupQuery.data ? setupQuery.data : { ...GENERIC_SETUP, environment: contextEnvironment || "development" };
  const isHub = Boolean(setup.is_hub);
  const keys = setup.env_keys?.length ? setup.env_keys : GENERIC_KEYS;
  const { base, token, short, path } = connectionKeys(keys);
  const environment = setup.environment ?? "development";
  const github = githubEnvironmentOf(environment);
  const part = PARTS.some((item) => item.id === params.get("part")) ? params.get("part") : "how";
  const mode = GITHUB_MODES.some((item) => item.id === params.get("github")) ? params.get("github") : "environments";
  const index = PARTS.findIndex((item) => item.id === part);

  function changeLang(value) {
    try {
      window.localStorage.setItem(LANG_KEY, value);
    } catch {
      // The choice then only lasts for this page.
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set("lang", value);
    setParams(nextParams, { replace: true });
  }

  const hrefFor = (id, extra = {}) => {
    const next = new URLSearchParams();
    next.set("part", id);
    if (applicationId) next.set("app", applicationId);
    if (params.get("lang")) next.set("lang", params.get("lang"));
    if (params.get("github")) next.set("github", params.get("github"));
    Object.entries(extra).forEach(([key, value]) => next.set(key, value));
    return `?${next.toString()}`;
  };

  const startContext = { environment: contextEnvironment, hubUrl };
  const appContext = { setup, isHub, keys, base, token, short, path, environment, github, mode, applicationId: applicationId || "<application id>" };
  const body = {
    how: <HowPart {...startContext} />,
    hub: <HubPart {...startContext} />,
    app: <AppPart {...startContext} />,
    signin: <SignInPart />,
    local: <LocalPart {...appContext} />,
    permissions: <PermissionsPart {...appContext} />,
    deploy: <DeployPart {...appContext} hrefFor={hrefFor} />,
    check: <CheckPart {...startContext} />,
    rotate: <RotatePart {...appContext} />,
    remove: <RemovePart />,
    problems: (
      <div className="space-y-8">
        <ProblemsPart />
        <TroubleshootingPart keys={keys} applicationId={appContext.applicationId} />
      </div>
    ),
  }[part];
  const previous = PARTS[index - 1];
  const next = PARTS[index + 1];
  const navParts = PARTS.map((item) => ({ id: item.id, label: t(item.label, item.label_id) }));
  const options = (appsQuery.data?.data ?? []).map((row) => ({ value: row.application_id, label: row.name }));

  return (
    <GuideLangContext.Provider value={lang}>
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Guides"
        description={
          contextEnvironment
            ? t(
                `How to connect the Hub and the applications to this Central. You are in the ${ENVIRONMENT_NAMES[contextEnvironment] ?? contextEnvironment} Central.`,
                `Cara menghubungkan Hub dan aplikasi ke Central ini. Anda sedang di Central ${ENVIRONMENT_NAMES[contextEnvironment] ?? contextEnvironment}.`,
              )
            : t("How to connect the Hub and the applications to this Central.", "Cara menghubungkan Hub dan aplikasi ke Central ini.")
        }
        actions={
          <Button asChild variant="secondary" size="icon" aria-label={t("Back To Applications", "Kembali Ke Aplikasi")} title={t("Back To Applications", "Kembali Ke Aplikasi")}>
            <Link to="/application-access"><ArrowLeft size={16} /></Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <SearchableSelect
            value={applicationId}
            onChange={(value) => {
              const nextParams = new URLSearchParams(params);
              if (value) nextParams.set("app", value);
              else nextParams.delete("app");
              setParams(nextParams);
            }}
            options={[{ value: "", label: t("General", "Umum") }, ...options]}
            placeholder={t("Application", "Aplikasi")}
          />
        </div>
        <SegmentedControl label="Language" options={GUIDE_LANGUAGES} value={lang} onChange={changeLang} />
      </div>
      {applicationId && setupQuery.isError ? <PanelMessage tone="error">{t("This application could not be found.", "Aplikasi ini tidak ditemukan.")}</PanelMessage> : null}
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
        <GuideNav parts={navParts} current={part} hrefFor={hrefFor} />
        <article aria-label={navParts[index].label} className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5 md:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">
              {t("Part", "Bagian")} {index + 1} {t("of", "dari")} {PARTS.length}
            </p>
            <h2 className="font-display text-xl font-bold text-(--mws-charcoal)">{navParts[index].label}</h2>
          </div>
          {body}
          <div className="flex items-center justify-between gap-3 border-t border-(--mws-line) pt-4">
            {previous ? (
              <Button asChild variant="secondary" size="icon" aria-label={t("Back", "Kembali")} title={t("Back", "Kembali")}>
                <Link to={hrefFor(previous.id)}><ArrowLeft size={14} /></Link>
              </Button>
            ) : (
              <span />
            )}
            {next ? (
              <Button asChild size="sm">
                <Link to={hrefFor(next.id)}>{t("Next", "Berikutnya")}: {t(next.label, next.label_id)}</Link>
              </Button>
            ) : (
              <Button asChild size="icon" aria-label={t("Back To Applications", "Kembali Ke Aplikasi")} title={t("Back To Applications", "Kembali Ke Aplikasi")}>
                <Link to="/application-access"></Link>
              </Button>
            )}
          </div>
        </article>
      </div>
    </div>
    </GuideLangContext.Provider>
  );
}
