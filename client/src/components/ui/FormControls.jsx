import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import dayjs from "dayjs";
import { ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";

const inputClasses =
  "h-11 w-full min-w-0 rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] disabled:bg-[var(--mws-soft)] disabled:text-[#8d7b7d]";

// Scoped to DateField only, not the whole app - MUI's default theme is blue
// (its primary.main), which otherwise leaks into the focused label/ring and
// the calendar popup's selected-day highlight, clashing with the burgundy
// focus color every other input in the app uses (see inputClasses above).
// Defined once at module scope, not per-render.
const dateFieldTheme = createTheme({
  palette: {
    primary: {
      // var(--mws-burgundy) - hardcoded since MUI's theme values need a
      // real color for its own color-mixing (hover/lighter/darker shades),
      // which doesn't work against an opaque CSS custom property.
      main: "#7e1518",
    },
  },
});

export function Field({ label, children, hint, error, className }) {
  return (
    <div className={cn("block space-y-1.5", className)}>
      <span
        className={cn(
          "font-display text-sm font-semibold",
          error ? "text-[#a43c41]" : "text-[var(--mws-charcoal)]",
        )}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span className="block text-xs font-medium leading-5 text-[#a43c41]">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs leading-5 text-[var(--mws-muted)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({ className, invalid, ...props }) {
  return (
    <input
      className={cn(
        inputClasses,
        invalid ? "border-[#c75f64]" : null,
        className,
      )}
      {...props}
    />
  );
}

// Drop-in replacement for <TextInput type="date">: same value/onChange
// contract (a "YYYY-MM-DD" string in, a synthetic { target: { value,
// validity } } event out - validity.badInput mirrors the native input's
// half-typed-segment quirk some forms check), but the format shown to the
// user is always DD/MM/YYYY regardless of the browser/OS locale, since a
// native date input's displayed format is locale-dependent and not
// something the page fully controls.
export function DateField({
  className,
  invalid,
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder,
  id,
  name,
}) {
  const parsedValue = value ? dayjs(value, "YYYY-MM-DD", true) : null;
  const minDate = min ? dayjs(min, "YYYY-MM-DD", true) : undefined;
  const maxDate = max ? dayjs(max, "YYYY-MM-DD", true) : undefined;

  function handleChange(nextValue) {
    if (!onChange) return;
    const isBadInput = Boolean(nextValue) && !nextValue.isValid();
    const nextStringValue =
      nextValue && nextValue.isValid() ? nextValue.format("YYYY-MM-DD") : "";
    onChange({
      target: {
        value: nextStringValue,
        validity: { badInput: isBadInput },
      },
    });
  }

  return (
    <ThemeProvider theme={dateFieldTheme}>
      <DatePicker
        value={parsedValue}
        onChange={handleChange}
        minDate={minDate}
        maxDate={maxDate}
        disabled={disabled}
        format="DD/MM/YYYY"
        slotProps={{
          textField: {
            id,
            name,
            placeholder,
            size: "small",
            fullWidth: true,
            className,
            error: invalid,
            sx: {
              "& .MuiInputBase-root": {
                height: "2.75rem",
                borderRadius: "0.75rem",
                backgroundColor: "#fff",
                fontSize: "0.875rem",
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: invalid ? "#c75f64" : "var(--mws-line)",
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: invalid ? "#c75f64" : "var(--mws-line)",
              },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderColor: "var(--mws-burgundy)",
                borderWidth: "2px",
              },
            },
          },
        }}
      />
    </ThemeProvider>
  );
}

export function DebouncedSearchInput({
  value,
  onChange,
  placeholder,
  delay = 400,
  className,
  inputClassName,
}) {
  const inputRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (inputRef.current && inputRef.current.value !== (value || "")) {
      inputRef.current.value = value || "";
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleChange(event) {
    const nextValue = event.target.value;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (nextValue !== (value || "")) onChange(nextValue);
    }, delay);
  }

  return (
    <label className={cn("relative block w-full min-w-0", className)}>
      <Search
        size={17}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
      />
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        defaultValue={value || ""}
        onChange={handleChange}
        className={cn(
          "h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]",
          inputClassName,
        )}
      />
    </label>
  );
}

export function SelectInput({ className, children, ...props }) {
  return (
    <select className={cn(inputClasses, className)} {...props}>
      {children}
    </select>
  );
}

export function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyLabel = "No options found",
  disabled = false,
  required = false,
  // Lets typing a value that isn't in `options` yet become the selection
  // itself, instead of forcing a pick from the list - e.g. Institution/Major,
  // where a genuinely new value should still be enterable inline. Always
  // shows the search box (typing is the only way to create), and surfaces a
  // "Use "..."" row when the typed text doesn't match an existing option.
  creatable = false,
  className,
  buttonClassName,
  searchableThreshold = 10,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);
  const searchInputRef = useRef(null);
  const shouldSearch = creatable || options.length >= searchableThreshold;
  const selectedOption = options.find((option) => option.value === value);
  // In creatable mode, a value with no matching option is itself the
  // selection (something typed in before, not yet a real master-data entry).
  const displayLabel = selectedOption?.label ?? (creatable ? value : null);
  const filteredOptions = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      [option.label, option.description, option.searchText, option.badge]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [options, searchTerm]);
  const trimmedSearchTerm = searchTerm.trim();
  const canCreateSearchTerm =
    creatable &&
    trimmedSearchTerm &&
    !options.some(
      (option) =>
        option.label.toLowerCase() === trimmedSearchTerm.toLowerCase(),
    );

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && shouldSearch) searchInputRef.current?.focus();
  }, [isOpen, shouldSearch]);

  function selectOption(option) {
    if (option.disabled) return;
    onChange(option.value);
    setSearchTerm("");
    setIsOpen(false);
  }

  function selectCustomValue(customValue) {
    onChange(customValue);
    setSearchTerm("");
    setIsOpen(false);
  }

  return (
    <div ref={wrapperRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          inputClasses,
          "flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed",
          required && !value ? "border-[#c75f64]" : null,
          buttonClassName,
        )}
      >
        <span className="min-w-0 flex-1">
          {displayLabel ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{displayLabel}</span>
              {selectedOption?.badge ? (
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    badgeToneClass(selectedOption.tone),
                  )}
                >
                  {selectedOption.badge}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-[var(--mws-muted)]">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={16} className="shrink-0 text-[var(--mws-muted)]" />
      </button>

      {isOpen ? (
        <div className="absolute z-50 mt-1 w-full min-w-0 overflow-hidden rounded-xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-28px_rgba(36,23,24,0.5)]">
          {shouldSearch ? (
            <label className="relative block border-b border-[var(--mws-line)]">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                placeholder={searchPlaceholder}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 w-full bg-white pl-9 pr-3 text-sm outline-none"
              />
            </label>
          ) : null}
          <div role="listbox" className="max-h-64 overflow-auto py-1">
            {canCreateSearchTerm ? (
              <button
                type="button"
                role="option"
                onClick={() => selectCustomValue(trimmedSearchTerm)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--mws-burgundy)] transition hover:bg-[var(--mws-soft)]"
              >
                <Plus size={15} className="shrink-0" />
                <span className="truncate">
                  Use &quot;{trimmedSearchTerm}&quot;
                </span>
              </button>
            ) : null}
            {filteredOptions.length === 0 && !canCreateSearchTerm ? (
              <div className="px-3 py-3 text-sm text-[var(--mws-muted)]">
                {emptyLabel}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onClick={() => selectOption(option)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm transition",
                    option.value === value
                      ? "bg-[var(--mws-soft)]"
                      : "hover:bg-[var(--mws-soft)]",
                    option.disabled ? "cursor-not-allowed opacity-60" : null,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-[var(--mws-charcoal)]">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block break-words text-xs text-[var(--mws-muted)]">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {option.badge ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                        badgeToneClass(option.tone),
                      )}
                    >
                      {option.badge}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function badgeToneClass(tone = "neutral") {
  const tones = {
    green: "bg-[#edf4eb] text-[#476b43]",
    amber: "bg-[#fff4d8] text-[#8a6419]",
    red: "bg-[#fff0f1] text-[#a43c41]",
    neutral: "bg-[#eef3fb] text-[var(--mws-navy)]",
  };
  return tones[tone] || tones.neutral;
}

// Toolbar filter dropdown, used above tables across the app. A thin
// SearchableSelect wrapper so every filter (short enum or long master-data
// lookup alike) shares the same trigger/panel styling - SearchableSelect
// itself only shows its own search box once there are enough options
// (searchableThreshold), so short lists don't grow one for nothing.
export function FilterSelect({ label, value, onChange, options }) {
  return (
    // In a flex-wrap toolbar (no grid to size against), SearchableSelect's
    // own min-w-0 lets it shrink to near-nothing, which then made its label
    // text ("Database Admin", "All Years", ...) wrap onto multiple lines
    // instead of staying on one. The min-width floor keeps it readable;
    // it's small enough not to fight a grid column's own width elsewhere.
    <div className="min-w-0 space-y-1.5 lg:min-w-44 lg:flex-none">
      <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
        {label}
      </span>
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={options[0]?.label || "Select"}
        searchPlaceholder={`Search ${label.toLowerCase()}`}
      />
    </div>
  );
}

export function TextAreaInput({ className, invalid, ...props }) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] disabled:bg-[var(--mws-soft)] disabled:text-[#8d7b7d]",
        invalid ? "border-[#c75f64]" : null,
        className,
      )}
      {...props}
    />
  );
}

export function CheckboxField({ label, description, className, ...props }) {
  return (
    <label
      className={cn(
        "flex min-h-11 gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2.5 text-sm text-[var(--mws-charcoal)] transition hover:border-[var(--mws-burgundy)]",
        // A description makes the label two lines - align the checkbox to
        // the first line (items-start + nudge down) instead of the whole
        // block's center, which would otherwise sink it below the middle.
        description ? "items-start" : "items-center",
        className,
      )}
    >
      <input
        type="checkbox"
        className={cn(
          "h-4 w-4 accent-[var(--mws-burgundy)]",
          description ? "mt-1" : null,
        )}
        {...props}
      />
      <span>
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="block text-xs text-[var(--mws-muted)]">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
