import { GraduationCap, KeyRound, Users } from "lucide-react";
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
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#7E15181A] px-2.5 py-1 font-mono text-xs font-bold text-(--mws-burgundy)">
        <KeyRound size={13} aria-hidden="true" />
        {roleKey}
      </span>
      <PermissionPopover permissions={permissions} />
    </div>
  );
}

// One strip describing a group, for pages that act inside it.
export function GroupSummary({ group }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-3">
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
  );
}
