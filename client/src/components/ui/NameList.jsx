import { ListPopover } from "./ListPopover.jsx";

// A list of names: "All" when empty, the name itself for one, a clickable count for more.
export function NameList({ names, noun, title, plain, danger = false }) {
  const color = danger ? "text-[#a43c41]" : "text-(--mws-charcoal)";
  if (names.length === 0)
    return (
      <span className={`text-sm font-semibold ${color}`}>
        {plain ?? "All"}
      </span>
    );
  if (names.length === 1) {
    return (
      <span
        className={`block truncate text-sm font-semibold ${color}`}
        title={names[0]}
      >
        {names[0]}
      </span>
    );
  }
  return (
    <ListPopover
      label={`${names.length} ${noun}`}
      count={names.length}
      dialogLabel={title}
      icon={false}
      mono={false}
      groups={[{ items: names }]}
      className={`[&>button]:text-sm ${danger ? "[&>button]:text-[#a43c41]" : "[&>button]:text-(--mws-charcoal)"}`}
    />
  );
}
