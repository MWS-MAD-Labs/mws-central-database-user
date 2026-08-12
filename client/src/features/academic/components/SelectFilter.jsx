import { SearchableSelect } from "../../../components/ui/FormControls.jsx";

export function SelectFilter({
  value,
  onChange,
  options,
  placeholder,
  children,
}) {
  if (options) {
    return (
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Search"
        className="w-full min-w-0 lg:w-56"
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full min-w-0 rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] lg:w-56"
    >
      {children}
    </select>
  );
}
