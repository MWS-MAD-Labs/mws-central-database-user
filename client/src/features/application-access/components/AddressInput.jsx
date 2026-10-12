import { cn } from "../../../lib/cn.js";
import { ENVIRONMENTS } from "../utils/applicationUrl.js";

// An address typed without its scheme. The environment decides whether http or https stands in front.
export function AddressInput({ label, environment, value, placeholder, invalid, onChange, onBlur }) {
  const scheme = ENVIRONMENTS.find((item) => item.id === environment)?.scheme;
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-stretch overflow-hidden rounded-xl border bg-white transition focus-within:border-(--mws-burgundy) focus-within:ring-2 focus-within:ring-[#7E15181A]",
        invalid ? "border-[#c75f64]" : "border-(--mws-line)",
      )}
    >
      <span className="flex shrink-0 items-center border-r border-(--mws-line) bg-(--mws-soft) px-3 font-mono text-xs text-(--mws-muted)">
        {scheme}
      </span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        inputMode="url"
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-(--mws-charcoal) outline-none placeholder:text-[#a8999b]"
        onChange={onChange}
        onBlur={onBlur}
      />
    </div>
  );
}
