import { GraduationCap, Users } from "lucide-react";
import { formatDateTime } from "../../../lib/format.js";
import { countOf, groupScopeChips, groupScopeSummary, groupShortTitle } from "../utils/groupSummary.js";
import { ListPopover } from "./ListPopover.jsx";
import { PermissionPopover } from "./PermissionPopover.jsx";

export function AudienceIcon({ audience, size = 18 }) {
  const Icon = audience === "STUDENTS" ? GraduationCap : Users;
  return <Icon size={size} aria-hidden="true" />;
}

const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-(--mws-muted)";

// A list of names: "All" when empty, the name itself for one, a clickable count for more.
function NameList({ names, noun, title, plain }) {
  if (names.length === 0) return <span className="text-sm font-semibold text-(--mws-charcoal)">{plain ?? "All"}</span>;
  if (names.length === 1) {
    return (
      <span className="block truncate text-sm font-semibold text-(--mws-charcoal)" title={names[0]}>
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
      className="[&>button]:text-sm [&>button]:text-(--mws-charcoal)"
    />
  );
}

// Units, positions and levels as small label over value pairs.
export function ScopeGrid({ group }) {
  return (
    <dl aria-label="Who this group covers" className="flex flex-wrap gap-x-6 gap-y-1">
      {groupScopeChips(group).map((chip) => (
        <div key={chip.label} className="min-w-0 max-w-56">
          <dt className={labelClass}>{chip.label}</dt>
          <dd>
            <NameList names={chip.names} noun={chip.noun} title={chip.label} />
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
      <span className={labelClass}>Role</span>
      <span className="font-display text-sm font-bold text-(--mws-burgundy)">{roleKey}</span>
      <PermissionPopover permissions={permissions} />
    </div>
  );
}

// How far a group reaches and what hangs off it.
export function GroupFacts({ group, parentRole }) {
  const facts = [
    { label: "Covers", value: countOf(group.covered_count ?? 0, group.audience) },
    group.own_count !== undefined && group.own_count !== group.covered_count
      ? { label: "Holds this role", value: countOf(group.own_count, group.audience) }
      : null,
    parentRole ? { label: "Part of", value: `${parentRole} group` } : null,
    group.updated_at ? { label: "Updated", value: formatDateTime(group.updated_at) } : null,
  ].filter(Boolean);
  return (
    <dl aria-label="Group details" className="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--mws-line) pt-3">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 max-w-72">
          <dt className={labelClass}>{fact.label}</dt>
          <dd className="truncate text-sm text-(--mws-charcoal)" title={fact.value}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// What a broad group still holds once narrower groups took their share.
export function RemainingScope({ group, narrower }) {
  if (narrower.length === 0) return null;
  const rows = [
    { label: "Units", noun: "units", list: group.remaining?.units, same: group.units },
    group.audience !== "STUDENTS"
      ? { label: "Positions", noun: "positions", list: group.remaining?.job_positions, same: group.job_positions }
      : null,
    group.audience !== "STUDENTS"
      ? { label: "Levels", noun: "levels", list: group.remaining?.job_levels, same: group.job_levels }
      : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3 rounded-xl bg-(--mws-soft) px-4 py-3">
      <p className="font-display text-sm font-bold text-(--mws-charcoal)">After narrower groups</p>
      <dl aria-label="What is left" className="flex flex-wrap gap-x-6 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0 max-w-56">
            <dt className={labelClass}>{row.label}</dt>
            <dd>
              {row.list === null || row.list === undefined ? (
                <NameList names={row.same.map((item) => item.name)} noun={row.noun} title={row.label} />
              ) : row.list.length === 0 ? (
                <span className="text-sm text-(--mws-muted)">None left</span>
              ) : (
                <NameList names={row.list.map((item) => item.name)} noun={row.noun} title={`${row.label} left`} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <p className={labelClass}>Taken by narrower groups</p>
        <ul className="mt-1 space-y-0.5 text-sm text-(--mws-charcoal)">
          {narrower.map((child) => (
            <li key={child.id}>
              <span className="font-display font-bold text-(--mws-burgundy)">{child.default_role_key}</span>
              <span className="text-(--mws-muted)"> · {groupScopeSummary(child)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// One strip describing a group, for pages that act inside it.
export function GroupSummary({ group, hasNarrower = false }) {
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
      {hasNarrower ? (
        <p className="text-xs text-(--mws-muted)">
          People in narrower groups are not listed here. Add their exceptions to that group.
        </p>
      ) : null}
    </div>
  );
}
