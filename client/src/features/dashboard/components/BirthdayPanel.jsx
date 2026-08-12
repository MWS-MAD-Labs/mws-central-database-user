import { SectionTitle } from "./SectionTitle";
import { Cake } from "lucide-react";

export function BirthdayPanel({ birthdays, isLoading }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <SectionTitle
        icon={Cake}
        title="Birthday This Month"
        caption="Current employee birthdays"
      />
      <div className="grid max-h-[24rem] gap-3 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="text-sm text-[var(--mws-muted)]">
            Loading birthdays...
          </p>
        ) : birthdays.length > 0 ? (
          birthdays.map((person) => (
            <div
              key={person.id}
              className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--mws-charcoal)]">
                    {person.full_name}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--mws-muted)]">
                    {person.unit} - {person.job_position}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-[var(--mws-burgundy)]">
                  {person.birthday}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--mws-muted)]">
            No employee birthdays this month.
          </p>
        )}
      </div>
    </section>
  );
}