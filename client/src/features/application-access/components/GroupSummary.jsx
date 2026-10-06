import { GraduationCap, Users } from "lucide-react";
import { formatDateTime } from "../../../lib/format.js";
import { groupScopeChips, groupShortTitle } from "../utils/groupSummary.js";
import { PermissionPopover } from "./PermissionPopover.jsx";

export function AudienceIcon({ audience, size = 18 }) {
  const Icon = audience === "STUDENTS" ? GraduationCap : Users;
  return <Icon size={size} aria-hidden="true" />;
}

// Units, positions and levels as small label over value pairs.
export function ScopeGrid({ group }) {
  return (
    <dl aria-label="Who this group covers" className="flex flex-wrap gap-x-6 gap-y-1">
      {groupScopeChips(group).map((chip) => (
        <div key={chip.label} className="min-w-0 max-w-56">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-(--mws-muted)">{chip.label}</dt>
          <dd className="truncate text-sm font-semibold text-(--mws-charcoal)" title={chip.value}>
            {chip.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// The role a group hands out, with its permissions one click away.
export function RolePill({ roleKey, permissions }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-(--mws-muted)">Role</span>
      <span className="font-display text-sm font-bold text-(--mws-burgundy)">{roleKey}</span>
      <PermissionPopover permissions={permissions} />
    </div>
  );
}

const audienceNoun = { EMPLOYEES: "employees", STUDENTS: "students", EMPLOYEES_AND_STUDENTS: "people" };

// How far a group reaches and what hangs off it.
export function GroupFacts({ group, parentTitle }) {
  const facts = [
    { label: "Covers", value: `${group.covered_count ?? 0} ${audienceNoun[group.audience]}` },
    {
      label: "Exceptions",
      value: `${group.exception_count}${group.blocked_count > 0 ? `, ${group.blocked_count} blocked` : ""}`,
    },
    parentTitle ? { label: "Inside", value: parentTitle } : null,
    group.updated_at ? { label: "Updated", value: formatDateTime(group.updated_at) } : null,
  ].filter(Boolean);
  return (
    <dl aria-label="Group details" className="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--mws-line) pt-3">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 max-w-72">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-(--mws-muted)">{fact.label}</dt>
          <dd className="truncate text-sm text-(--mws-charcoal)" title={fact.value}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// One strip describing a group, for pages that act inside it.
export function GroupSummary({ group }) {
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="flex items-center gap-2 font-display text-sm font-bold text-(--mws-charcoal)">
          <span className="text-(--mws-burgundy)">
            <AudienceIcon audience={group.audience} />
          </span>
          {groupShortTitle(group)}
        </div>
        <ScopeGrid group={group} />
        <div className="sm:ml-auto">
          <RolePill roleKey={group.default_role_key} permissions={group.permissions} />
        </div>
      </div>
      <GroupFacts group={group} />
    </div>
  );
}
