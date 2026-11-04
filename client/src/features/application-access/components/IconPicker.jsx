import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../../lib/cn.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { Button } from "../../../components/ui/Button.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { DEFAULT_ICON, HUB_ICON_NAMES, HUB_ICONS } from "../utils/hubIcons.js";
import { applicationLogosApi } from "../api/applicationLogosApi.js";
import { checkLogoFile, LOGO_ACCEPT, LOGO_HINT } from "../utils/imageSniff.js";
import { LOGOS_KEY, useApplicationLogos } from "../hooks/useApplicationLogos.js";
import { LogoImage } from "./LogoImage.jsx";

const TABS = [
  { id: "icon", label: "Icon" },
  { id: "upload", label: "Upload" },
];

const optionClass =
  "flex h-10 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-(--mws-soft) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)";

function IconTab({ value, logoId, onChoose }) {
  const [search, setSearch] = useState("");
  const names = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? HUB_ICON_NAMES.filter((name) => name.toLowerCase().includes(needle)) : HUB_ICON_NAMES;
  }, [search]);

  return (
    <>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--mws-muted)" aria-hidden="true" />
        <input
          aria-label="Search icons"
          value={search}
          autoComplete="off"
          placeholder="Search icons"
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 w-full rounded-lg border border-(--mws-line) bg-white pl-8 pr-3 text-sm outline-none focus:border-(--mws-burgundy)"
        />
      </div>
      <div role="listbox" aria-label="Icons" className="mt-3 grid max-h-56 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8">
        {names.map((name) => {
          const Icon = HUB_ICONS[name];
          const selected = !logoId && name === value;
          return (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={name}
              title={name}
              onClick={() => onChoose(name)}
              className={cn(optionClass, "text-(--mws-charcoal)", selected && "bg-[#7E15181A] text-(--mws-burgundy)")}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          );
        })}
        {names.length === 0 ? <p className="col-span-full py-4 text-center text-xs text-(--mws-muted)">No icon matches.</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onChoose("")}
        className="mt-2 cursor-pointer text-xs font-medium text-(--mws-muted) underline-offset-4 hover:text-(--mws-charcoal) hover:underline"
      >
        Use the default icon
      </button>
    </>
  );
}

// Logos already uploaded, plus a new upload that is picked right away.
function UploadTab({ logos, logoId, onChoose }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");

  const mutation = useMutation({
    mutationFn: () => applicationLogosApi.upload({ name: name.trim(), file }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: LOGOS_KEY });
      showSuccessToast("Logo uploaded.");
      onChoose(created.id);
    },
    onError: (error) => showErrorToast(error, "The logo could not be uploaded."),
  });

  async function pick(event) {
    const picked = event.target.files?.[0] ?? null;
    setFile(null);
    setProblem("");
    if (!picked) return;
    const { problem: reason } = await checkLogoFile(picked);
    if (reason) {
      setProblem(reason);
      // Lets the same file be picked again after fixing it.
      event.target.value = "";
      return;
    }
    setFile(picked);
    if (!name.trim()) setName(picked.name.replace(/\.[^.]+$/, "").slice(0, 64));
  }

  return (
    <>
      {logos.length > 0 ? (
        <div role="listbox" aria-label="Logos" className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8">
          {logos.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === logoId}
              aria-label={item.name}
              title={item.name}
              onClick={() => onChoose(item.id)}
              className={cn(optionClass, item.id === logoId && "bg-[#7E15181A]")}
            >
              <LogoImage id={item.id} version={item.version} size={28} />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-(--mws-muted)">No logos yet. Upload the first one.</p>
      )}
      <div className={cn("space-y-2", logos.length > 0 && "mt-3 border-t border-(--mws-line) pt-3")}>
        <input
          type="file"
          accept={LOGO_ACCEPT}
          aria-label="Logo file"
          onChange={pick}
          className="block w-full text-sm text-(--mws-charcoal) file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-(--mws-line) file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold"
        />
        <p className={cn("text-xs", problem ? "text-[#a43c41]" : "text-(--mws-muted)")}>{problem || LOGO_HINT}</p>
        {file ? (
          <div className="flex gap-2">
            <input
              aria-label="Logo name"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              placeholder="Logo name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-(--mws-line) bg-white px-3 text-sm outline-none focus:border-(--mws-burgundy)"
            />
            <Button type="button" disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              <Upload size={16} aria-hidden="true" />
              {mutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

// The picture on the Hub card: one of the Hub's icons, or a logo. Empty means the default icon. Picking one clears the other.
export function IconPicker({ value, onChange, logoId = "", onPickLogo, label = "Logo" }) {
  const { logos } = useApplicationLogos();
  const currentLogo = logos.find((item) => item.id === logoId);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("icon");
  const Current = HUB_ICONS[value] || HUB_ICONS[DEFAULT_ICON];

  function toggle() {
    if (!open) setTab(logoId && onPickLogo ? "upload" : "icon");
    setOpen((current) => !current);
  }

  function chooseIcon(name) {
    onChange(name);
    setOpen(false);
  }

  function chooseLogo(id) {
    onPickLogo?.(id);
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
        className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-xl border border-(--mws-line) bg-white px-3 text-left text-sm text-(--mws-charcoal) transition hover:border-(--mws-burgundy) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)"
      >
        {currentLogo ? (
          <LogoImage id={currentLogo.id} version={currentLogo.version} size={22} />
        ) : (
          <Current size={18} className="shrink-0 text-(--mws-burgundy)" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate">{currentLogo ? currentLogo.name : value || `Default (${DEFAULT_ICON})`}</span>
        <ChevronDown size={16} className={cn("shrink-0 text-(--mws-muted) transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className="rounded-xl border border-(--mws-line) bg-white p-3 shadow-sm">
          {onPickLogo ? (
            <div className="mb-3">
              <Tabs tabs={TABS} active={tab} onChange={setTab} label={`${label} source`} />
            </div>
          ) : null}
          {tab === "upload" && onPickLogo ? (
            <UploadTab logos={logos} logoId={logoId} onChoose={chooseLogo} />
          ) : (
            <IconTab value={value} logoId={logoId} onChoose={chooseIcon} />
          )}
        </div>
      ) : null}
    </div>
  );
}
