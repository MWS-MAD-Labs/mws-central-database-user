const STEPS = [
  ["Deploy", "Copy the .env values into the application and deploy it."],
  ["Permissions", "The application sends its permission list."],
  ["Roles", "Group permissions into roles."],
  ["Groups", "Say who gets which role."],
  ["Show in Hub", "Publish it when the rest is done."],
];

// What comes after this form, so nobody is left wondering.
export function NextStepsCard({ hub = false }) {
  return (
    <div className="rounded-2xl border border-(--mws-line) bg-white p-5">
      <p className="font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">What Happens Next</p>
      <ol className="mt-3 space-y-3">
        {STEPS.filter(([title]) => !(hub && title === "Show in Hub")).map(([title, text], index) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--mws-soft) text-xs font-bold text-(--mws-burgundy)">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-(--mws-charcoal)">{title}</p>
              <p className="text-xs leading-5 text-(--mws-muted)">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
