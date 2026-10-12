import { Eye } from "lucide-react";
import { Link } from "react-router";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";

// The teachers and interns a class can take, laid out like the students in Enroll Student: a search box, a box with
// one row per person (name, job position, an eye to open their detail), the page bar inside the box, and a line
// that says who is picked. One person is picked at a time, so the rows are radios.
export function TeacherCandidateList({
  items,
  selectedValue,
  selectedName,
  paging,
  search,
  isLoading,
  emptyMessage,
  onSelect,
  onSearchChange,
  onPrevious,
  onNext,
  onPageSizeChange,
}) {
  return (
    <div className="space-y-2">
      <TextInput
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={isLoading && items.length === 0 ? "Loading teachers..." : "Search Name or Job Position"}
      />
      <div className="overflow-hidden rounded-xl border border-(--mws-line) bg-white">
        {items.length > 0 ? (
          <p className="border-b border-(--mws-line) bg-(--mws-soft) px-3 py-2 text-sm font-semibold text-(--mws-charcoal)">
            Pick one of the {paging.total_item} on this list
          </p>
        ) : null}
        {items.length === 0 ? (
          <p className={`p-3 text-sm text-(--mws-muted) ${isLoading ? "font-semibold" : "leading-6"}`}>
            {isLoading ? "Loading teachers..." : emptyMessage}
          </p>
        ) : (
          <div role="radiogroup" aria-label="Teacher" className="divide-y divide-(--mws-line)">
            {items.map((item) => (
              <div key={item.value} className="flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-(--mws-soft)">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="assign-teacher"
                    aria-label={item.label}
                    checked={selectedValue === item.value}
                    onChange={() => onSelect(item.value)}
                    className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-(--mws-charcoal)">{item.label}</p>
                    {item.sublabel ? <p className="truncate text-xs text-(--mws-muted)">{item.sublabel}</p> : null}
                  </div>
                </label>
                <Link
                  to={item.href}
                  target="_blank"
                  rel="noreferrer"
                  title="Open teacher detail in a new tab"
                  aria-label={`Open ${item.label} in a new tab`}
                  className="shrink-0 rounded-lg p-1.5 text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                >
                  <Eye size={15} />
                </Link>
              </div>
            ))}
          </div>
        )}
        {paging.total_item > 0 ? (
          <PaginationBar
            paging={paging}
            itemLabel="teachers"
            isLoading={isLoading}
            onPrevious={onPrevious}
            onNext={onNext}
            onPageSizeChange={onPageSizeChange}
          />
        ) : null}
      </div>
      <p className="text-xs font-semibold text-(--mws-muted)">
        {selectedValue ? `${selectedName || "1 teacher"} selected.` : "No teacher selected."}
      </p>
    </div>
  );
}
