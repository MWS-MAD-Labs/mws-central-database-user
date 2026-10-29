import { CalendarDays, Users } from "lucide-react";
import { Link } from "react-router";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { formatDate } from "../../../lib/format.js";
import { timeAgo } from "../utils/setupSteps.js";
import { addressState, connectionState, overallState } from "../utils/connectionState.js";

const DOT = {
  green: { color: "bg-[#58a451]", ping: true },
  amber: { color: "bg-[#d9a22b]", ping: false },
  red: { color: "bg-[#c75f64]", ping: false },
  grey: { color: "bg-[#b8b0ad]", ping: false },
};

// A dot that blinks while something is live or on its way, and stays still when it is not.
function Dot({ tone, pulse, className }) {
  const { color } = DOT[tone];
  return (
    <span aria-hidden="true" className={cn("relative flex size-2.5 shrink-0 items-center justify-center", className)}>
      {pulse ? <span className={cn("absolute inline-flex size-full rounded-full opacity-50 motion-safe:animate-ping", color)} /> : null}
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}

function Cell({ label, children }) {
  return (
    <div className="min-w-0 space-y-1 px-5 py-3">
      <p className="font-display text-[11px] font-bold uppercase tracking-wide text-(--mws-muted)">{label}</p>
      {children}
    </div>
  );
}

// The summary at the top of Settings: where it shows, whether it works, who can open it and since when. Working needs
// both: the application calls Central with its token, and its sign-in address answers.
export function AppStatusStrip({ hubStatus, link, isHub = false, address = null, health, connection, access, createdAt, groupsPath, onCheck, checking = false }) {
  const state = overallState({ link, isHub, health, connection, address });
  const token = connectionState({ link, health, connection });
  const addressLine = addressState({ link, isHub, address });
  const checkedAgo = address?.checked_at ? timeAgo(address.checked_at) : null;
  const people = access?.people;
  return (
    <div className="grid grid-cols-2 divide-y divide-(--mws-line) rounded-2xl border border-(--mws-line) bg-white text-sm md:grid-cols-4 md:divide-x md:divide-y-0">
      <Cell label="Visibility">
        <StatusBadge tone={hubStatus.tone}>{hubStatus.label}</StatusBadge>
      </Cell>
      <Cell label="Health">
        <p className="flex items-center gap-2 font-semibold text-(--mws-charcoal)">
          <Dot tone={state.tone} pulse={state.pulse} />
          {state.label}
        </p>
        <p className="text-xs text-(--mws-muted)">{state.note}</p>
        {link ? null : (
          <div className="mt-3 space-y-2.5">
            <div className="flex items-start gap-2 text-xs text-(--mws-charcoal)" title="The application calls Central with its token">
              <Dot tone={token.tone} pulse={false} className="mt-1" />
              <p>{`Calls Central: ${token.label}`}</p>
            </div>
            {addressLine ? (
              <div className="flex items-start gap-2 text-xs text-(--mws-charcoal)" title={addressLine.title}>
                <Dot tone={addressLine.tone} pulse={false} className="mt-1" />
                <div className="space-y-0.5">
                  <p>{`Sign-In Address: ${addressLine.label}`}</p>
                  {checkedAgo ? (
                    <p className="text-(--mws-muted)">{`Checked ${checkedAgo === "Just Now" ? "Just Now" : `${checkedAgo} Ago`}`}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {onCheck && addressLine ? (
              <button
                type="button"
                onClick={onCheck}
                disabled={checking}
                className="text-xs font-semibold text-(--mws-burgundy) hover:underline disabled:opacity-60"
              >
                {checking ? "Checking…" : "Check Now"}
              </button>
            ) : null}
          </div>
        )}
      </Cell>
      <Cell label="People">
        {access ? (
          <>
            <p className="flex items-center gap-2 font-semibold text-(--mws-charcoal)">
              <Users size={15} aria-hidden="true" className="text-(--mws-muted)" />
              {`${people} ${people === 1 ? "Person" : "People"} With Access`}
            </p>
            <p className="text-xs text-(--mws-muted)">
              {`${access.groups} ${access.groups === 1 ? "Group" : "Groups"} · ${access.exceptions} ${access.exceptions === 1 ? "Exception" : "Exceptions"} · ${access.blocked} Blocked`}
              {groupsPath ? (
                <>
                  {" · "}
                  <Link to={groupsPath} className="font-semibold text-(--mws-burgundy) hover:underline">
                    Open Groups
                  </Link>
                </>
              ) : null}
            </p>
          </>
        ) : (
          <div aria-hidden="true" className="h-9 w-32 animate-pulse rounded-lg bg-(--mws-soft)" />
        )}
      </Cell>
      <Cell label="Created">
        {createdAt ? (
          <>
            <p className="flex items-center gap-2 font-semibold text-(--mws-charcoal)">
              <CalendarDays size={15} aria-hidden="true" className="text-(--mws-muted)" />
              {formatDate(createdAt)}
            </p>
            <p className="text-xs text-(--mws-muted)">{timeAgo(createdAt) === "Just Now" ? "Just Now" : `${timeAgo(createdAt)} Ago`}</p>
          </>
        ) : (
          <div aria-hidden="true" className="h-9 w-28 animate-pulse rounded-lg bg-(--mws-soft)" />
        )}
      </Cell>
    </div>
  );
}
