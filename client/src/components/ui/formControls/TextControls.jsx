import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../../../lib/cn.js";
import { inputClasses } from "./sharedStyles.js";

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

export function TextAreaInput({ className, invalid, ...props }) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-xl border border-(--mws-line) bg-white px-3 py-2 text-sm text-(--mws-charcoal) outline-none transition focus:border-(--mws-burgundy) focus:ring-2 focus:ring-[#7E15181A] disabled:bg-(--mws-soft) disabled:text-[#8d7b7d]",
        invalid ? "border-[#c75f64]" : null,
        className,
      )}
      {...props}
    />
  );
}

export function SelectInput({ className, children, ...props }) {
  return (
    <select className={cn(inputClasses, className)} {...props}>
      {children}
    </select>
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
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--mws-muted)"
      />
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        defaultValue={value || ""}
        onChange={handleChange}
        className={cn(
          "h-11 w-full rounded-xl border border-(--mws-line) bg-white pl-10 pr-3 text-sm outline-none transition focus:border-(--mws-burgundy) focus:ring-2 focus:ring-[#7E15181A]",
          inputClassName,
        )}
      />
    </label>
  );
}
