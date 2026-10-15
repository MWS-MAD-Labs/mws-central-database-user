import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/cn.js";
import { inputClasses } from "./sharedStyles.js";

export function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyLabel = "No options found",
  disabled = false,
  required = false,
  creatable = false,
  className,
  buttonClassName,
  searchableThreshold = 10,
  openUpward = false,
  // Remote mode: `options` is a server-provided page matching the current
  // search term, not the full list - local filtering is skipped and
  // `onSearchChange` is called (debounced) as the user types instead.
  remote = false,
  onSearchChange,
  isLoading = false,
  // Lets the caller keep showing the selected item's label/badge even when
  // it has scrolled out of the current server page (e.g. the user re-typed
  // a different search after picking someone).
  selectedOption: selectedOptionOverride,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [highlightSyncKey, setHighlightSyncKey] = useState(null);
  const wrapperRef = useRef(null);
  const popupRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const [popupRect, setPopupRect] = useState(null);
  const shouldSearch = remote || creatable || options.length >= searchableThreshold;
  const selectedOption =
    selectedOptionOverride ?? options.find((option) => option.value === value);
  const displayLabel = selectedOption?.label ?? (creatable ? value : null);
  const filteredOptions = useMemo(() => {
    if (remote) return options;
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      [option.label, option.description, option.searchText, option.badge]
        .filter((part) => typeof part === "string" && part)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [options, searchTerm, remote]);

  useEffect(() => {
    if (!remote || !onSearchChange) return undefined;
    const handle = setTimeout(() => onSearchChange(searchTerm), 300);
    return () => clearTimeout(handle);
  }, [remote, onSearchChange, searchTerm]);
  const trimmedSearchTerm = searchTerm.trim();
  const canCreateSearchTerm =
    creatable &&
    trimmedSearchTerm &&
    !options.some(
      (option) =>
        option.label.toLowerCase() === trimmedSearchTerm.toLowerCase(),
    );
  const combinedItems = useMemo(() => {
    const items = [];
    if (canCreateSearchTerm) {
      items.push({ type: "custom", value: trimmedSearchTerm });
    }
    for (const option of filteredOptions) {
      items.push({ type: "option", option });
    }
    return items;
  }, [canCreateSearchTerm, trimmedSearchTerm, filteredOptions]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (
        !wrapperRef.current?.contains(event.target) &&
        !popupRef.current?.contains(event.target)
      ) {
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

  const [wasOpenForRect, setWasOpenForRect] = useState(false);
  if (isOpen !== wasOpenForRect) {
    setWasOpenForRect(isOpen);
    if (!isOpen) setPopupRect(null);
  }

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    function reposition() {
      const trigger = wrapperRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const estimatedPopupHeight = 300;
      const spaceBelow = window.innerHeight - rect.bottom;
      const flip =
        openUpward ||
        (spaceBelow < estimatedPopupHeight && rect.top > spaceBelow);
      setPopupRect({
        left: rect.left,
        width: rect.width,
        top: rect.bottom,
        bottom: window.innerHeight - rect.top,
        flip,
      });
    }

    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen, openUpward]);

  useEffect(() => {
    if (isOpen && shouldSearch) searchInputRef.current?.focus();
  }, [isOpen, shouldSearch]);

  // The highlight starts again on every opening: on the picked option, or on none when
  // nothing is picked, so no option looks active before the person points at one.
  const nextHighlightSyncKey = `${isOpen}:${searchTerm}`;
  if (!isOpen && highlightSyncKey !== null) {
    setHighlightSyncKey(null);
  } else if (isOpen && nextHighlightSyncKey !== highlightSyncKey) {
    setHighlightSyncKey(nextHighlightSyncKey);
    const selectedIndex = combinedItems.findIndex(
      (item) => item.type === "option" && item.option.value === value,
    );
    if (selectedIndex !== highlightedIndex) setHighlightedIndex(selectedIndex);
  }

  useEffect(() => {
    if (highlightedIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

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

  function selectHighlighted() {
    const item = combinedItems[highlightedIndex];
    if (!item) return;
    if (item.type === "custom") selectCustomValue(item.value);
    else selectOption(item.option);
  }

  function handleListKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        combinedItems.length === 0 ? -1 : (current + 1) % combinedItems.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        combinedItems.length === 0
          ? -1
          : current < 0
            ? combinedItems.length - 1
            : (current - 1 + combinedItems.length) % combinedItems.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectHighlighted();
    }
  }

  function handleTriggerKeyDown(event) {
    if (isOpen) {
      handleListKeyDown(event);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
    }
  }

  return (
    <div ref={wrapperRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
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
              <span
                className={cn(
                  "truncate",
                  !selectedOption?.badge && selectedOption?.tone
                    ? textToneClass(selectedOption.tone)
                    : null,
                )}
              >
                {displayLabel}
              </span>
              {selectedOption?.badge ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-full px-1.5 py-1 text-[11px] font-semibold leading-none",
                    badgeToneClass(selectedOption.tone),
                  )}
                >
                  {selectedOption.badge}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-(--mws-muted)">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={16} className="shrink-0 text-(--mws-muted)" />
      </button>

      {isOpen && popupRect
        ? createPortal(
            <div
              ref={popupRef}
              style={{
                position: "fixed",
                left: popupRect.left,
                width: popupRect.width,
                ...(popupRect.flip
                  ? { bottom: popupRect.bottom + 4 }
                  : { top: popupRect.top + 4 }),
              }}
              className="z-100 min-w-0 overflow-hidden rounded-xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-28px_rgba(36,23,24,0.5)]"
            >
              {shouldSearch ? (
                <label className="relative block border-b border-(--mws-line)">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--mws-muted)"
                  />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchTerm}
                    placeholder={searchPlaceholder}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onKeyDown={handleListKeyDown}
                    className="h-10 w-full appearance-none bg-white pl-9 pr-10 text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
                  />
                  {searchTerm ? (
                    <button
                      type="button"
                      aria-label={`Clear ${searchPlaceholder}`}
                      onClick={() => {
                        setSearchTerm("");
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2 top-1/2 flex h-6 w-6 min-w-6 shrink-0 aspect-square -translate-y-1/2 items-center justify-center rounded-full border border-[#7E151833] bg-[#7E15180D] text-(--mws-burgundy) transition hover:border-(--mws-burgundy) hover:bg-[#7E15181A] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--mws-burgundy)"
                    >
                      <X size={13} strokeWidth={2.4} />
                    </button>
                  ) : null}
                </label>
              ) : null}
              <div
                ref={listRef}
                role="listbox"
                className="max-h-64 overflow-auto py-1"
              >
                {canCreateSearchTerm ? (
                  <button
                    type="button"
                    role="option"
                    data-index={0}
                    onClick={() => selectCustomValue(trimmedSearchTerm)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-(--mws-burgundy) transition hover:bg-(--mws-soft)",
                      highlightedIndex === 0 ? "bg-(--mws-soft)" : null,
                    )}
                  >
                    <Plus size={15} className="shrink-0" />
                    <span className="truncate">
                      Use &quot;{trimmedSearchTerm}&quot;
                    </span>
                  </button>
                ) : null}
                {filteredOptions.length === 0 && !canCreateSearchTerm ? (
                  <div className="px-3 py-3 text-sm text-(--mws-muted)">
                    {remote && isLoading ? "Searching..." : emptyLabel}
                  </div>
                ) : (
                  filteredOptions.map((option, index) => {
                    const combinedIndex = canCreateSearchTerm
                      ? index + 1
                      : index;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        data-index={combinedIndex}
                        aria-selected={option.value === value}
                        disabled={option.disabled}
                        onClick={() => selectOption(option)}
                        onMouseEnter={() => setHighlightedIndex(combinedIndex)}
                        className={cn(
                          "flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm transition",
                          highlightedIndex === combinedIndex ? "bg-(--mws-soft)" : null,
                          option.disabled
                            ? "cursor-not-allowed opacity-60"
                            : null,
                        )}
                      >
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate",
                              option.value === value ? "font-bold" : "font-medium",
                              !option.badge && option.tone
                                ? textToneClass(option.tone)
                                : "text-(--mws-charcoal)",
                            )}
                          >
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="mt-0.5 block wrap-break-word text-xs text-(--mws-muted)">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                        {option.badge ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              badgeToneClass(option.tone),
                            )}
                          >
                            {option.badge}
                          </span>
                        ) : null}
                        {option.value === value ? (
                          <Check
                            size={15}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-(--mws-burgundy)"
                          />
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function badgeToneClass(tone = "neutral") {
  const tones = {
    green: "bg-[#edf4eb] text-[#476b43]",
    amber: "bg-[#fff4d8] text-[#8a6419]",
    red: "bg-[#fff0f1] text-[#a43c41]",
    neutral: "bg-[#eef3fb] text-(--mws-navy)",
  };
  return tones[tone] || tones.neutral;
}

function textToneClass(tone) {
  const tones = {
    green: "text-[#476b43]",
    amber: "text-[#8a6419]",
    red: "text-[#a43c41]",
    neutral: "text-(--mws-muted)",
  };
  return tones[tone] || null;
}

export function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="w-full min-w-0 space-y-1.5 sm:w-auto lg:min-w-44 lg:max-w-56 lg:flex-none">
      <span className="block font-display text-xs font-bold text-(--mws-muted)">
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
