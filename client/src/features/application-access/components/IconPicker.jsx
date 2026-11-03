import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../../lib/cn.js";
import { DEFAULT_ICON, HUB_ICON_NAMES, HUB_ICONS } from "../utils/hubIcons.js";
import { useApplicationLogos } from "../hooks/useApplicationLogos.js";
import { LogoImage } from "./LogoImage.jsx";

// Pick the picture shown on the Hub card: a logo of the master data, or one of the icons the Hub can draw. Empty means
// the default icon. Picking one takes the other off.
export function IconPicker({ value, onChange, logoId = "", onPickLogo, label = "Icon" }) {
  const { logos } = useApplicationLogos();
  const currentLogo = logos.find((item) => item.id === logoId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const Current = HUB_ICONS[value] || HUB_ICONS[DEFAULT_ICON];
  const names = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? HUB_ICON_NAMES.filter((name) => name.toLowerCase().includes(needle)) : HUB_ICON_NAMES;
  }, [search]);

  function choose(name) {
    onChange(name);
    setOpen(false);
    setSearch("");
  }

  function chooseLogo(id) {
    onPickLogo?.(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
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
          {onPickLogo && logos.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-(--mws-muted)">Logos</p>
              <div role="listbox" aria-label="Logos" className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8">
                {logos.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === logoId}
                    aria-label={item.name}
                    title={item.name}
                    onClick={() => chooseLogo(item.id)}
                    className={cn(
                      "flex h-10 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-(--mws-soft) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)",
                      item.id === logoId && "bg-[#7E15181A]",
                    )}
                  >
                    <LogoImage id={item.id} version={item.version} size={28} />
                  </button>
                ))}
              </div>
              <p className="mb-1 mt-3 text-xs font-semibold text-(--mws-muted)">Icons</p>
            </div>
          ) : null}
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
                  onClick={() => choose(name)}
                  className={cn(
                    "flex h-10 cursor-pointer items-center justify-center rounded-lg text-(--mws-charcoal) transition-colors hover:bg-(--mws-soft) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)",
                    selected && "bg-[#7E15181A] text-(--mws-burgundy)",
                  )}
                >
                  <Icon size={18} aria-hidden="true" />
                </button>
              );
            })}
            {names.length === 0 ? <p className="col-span-full py-4 text-center text-xs text-(--mws-muted)">No icon matches.</p> : null}
          </div>
          <button
            type="button"
            onClick={() => choose("")}
            className="mt-2 cursor-pointer text-xs font-medium text-(--mws-muted) underline-offset-4 hover:text-(--mws-charcoal) hover:underline"
          >
            Use the default icon
          </button>
        </div>
      ) : null}
    </div>
  );
}
