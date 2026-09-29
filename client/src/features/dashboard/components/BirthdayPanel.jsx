import { formatBirthday } from "../utils/dashboardFormatters";
import { SectionTitle } from "./SectionTitle";
import { Cake } from "lucide-react";
import { RestrictedDashboardPanel } from "./RestrictedDashboardPanel.jsx";

export function BirthdayPanel({ birthdays, isLoading, restricted = false }) {
  const today = new Date().getDate();
  const todaysBirthdays = birthdays.filter((person) => person.day === today);

  return (
    <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <SectionTitle
        icon={Cake}
        title="Birthday This Month"
        caption="Current employee birthdays"
      />
      {!restricted && !isLoading && todaysBirthdays.length > 0 ? (
        <p className="mt-2 mb-1 rounded-xl bg-[#fff4d8] px-3 py-2 text-sm font-semibold text-[#8a6419]">
          {todaysBirthdays.length === 1
            ? `${todaysBirthdays[0].full_name} has a birthday today!`
            : `${todaysBirthdays.length} people have a birthday today!`}
        </p>
      ) : null}
      {restricted ? (
        <RestrictedDashboardPanel
          title="Staff Birthdays"
          message="Employee & Intern access is required to view staff birthdays."
        />
      ) : (
        <div className="grid max-h-[24rem] gap-3 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="text-sm text-(--mws-muted)">Loading birthdays...</p>
          ) : birthdays.length > 0 ? (
            birthdays.map((person) => (
              <div
                key={person.id}
                className="min-w-0 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-(--mws-charcoal)">
                      {person.full_name}
                    </p>
                    <p className="mt-1 truncate text-xs text-(--mws-muted)">
                      {person.unit} - {person.job_position}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {person.day === today ? (
                      <span className="rounded-full bg-[#fff4d8] px-2 py-0.5 text-[10px] font-bold text-[#8a6419]">
                        Today
                      </span>
                    ) : null}
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-(--mws-burgundy)">
                      {formatBirthday(person.birthday)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-(--mws-muted)">
              No employee birthdays this month.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
