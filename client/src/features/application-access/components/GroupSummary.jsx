import { GraduationCap, Users } from "lucide-react";
import { formatDateTime } from "../../../lib/format.js";
import {
  countOf,
  groupScopeChips,
  groupShortTitle,
} from "../utils/groupSummary.js";
import { UNKNOWN_LEGACY_UNIT_NAME } from "../utils/legacyUnit.js";
import { ListPopover } from "./ListPopover.jsx";
import { PermissionPopover } from "./PermissionPopover.jsx";

export function AudienceIcon({ audience, size = 18 }) {
  const Icon = audience === "STUDENTS" ? GraduationCap : Users;
  return <Icon size={size} aria-hidden="true" />;
}

const labelClass =
  "text-[11px] font-semibold uppercase tracking-wide text-(--mws-muted)";

// A list of names: "All" when empty, the name itself for one, a clickable count for more.
function NameList({ names, noun, title, plain }) {
  if (names.length === 0)
    return (
      <span className="text-sm font-semibold text-(--mws-charcoal)">
        {plain ?? "All"}
      </span>
    );
  if (names.length === 1) {
    return (
      <span
        className="block truncate text-sm font-semibold text-(--mws-charcoal)"
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
      className="[&>button]:text-sm [&>button]:text-(--mws-charcoal)"
    />
  );
}

// Units, positions and levels as small label over value pairs.
export function ScopeGrid({ group, label = "Who this group covers" }) {
  return (
    <dl
      aria-label={label}
      className="flex flex-wrap gap-x-6 gap-y-1"
    >
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
      <span className="font-display text-sm font-bold text-(--mws-burgundy)">
        {roleKey}
      </span>
      <PermissionPopover permissions={permissions} />
    </div>
  );
}

// How far a group reaches and what hangs off it.
export function GroupFacts({ group, parentRole }) {
  const facts = [
    {
      label: "Covers",
      value: countOf(group.covered_count ?? 0, group.audience),
    },
    group.own_count !== undefined && group.own_count !== group.covered_count
      ? {
          label: "Holds this role",
          value: countOf(group.own_count, group.audience),
        }
      : null,
    parentRole ? { label: "Part of", value: `${parentRole} group` } : null,
    group.updated_at
      ? { label: "Updated", value: formatDateTime(group.updated_at) }
      : null,
  ].filter(Boolean);
  return (
    <dl
      aria-label="Group details"
      className="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--mws-line) pt-3"
    >
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 max-w-72">
          <dt className={labelClass}>{fact.label}</dt>
          <dd
            className="truncate text-sm text-(--mws-charcoal)"
            title={fact.value}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// One dimension after narrower groups: as saved, "All except N", a short list, or nothing.
function LeftValue({ left, scopeNames, noun, title }) {
  if (!left) return <NameList names={scopeNames} noun={noun} title={title} />;
  const names = (list) => list.map((item) => item.name).filter((name) => name !== UNKNOWN_LEGACY_UNIT_NAME);
  const kept = names(left.kept);
  const dropped = names(left.dropped);
  if (kept.length === 0) return <span className="text-sm text-(--mws-muted)">None left</span>;
  if (scopeNames.length === 0 && kept.length > 1 && dropped.length > 0 && dropped.length <= kept.length) {
    return (
      <ListPopover
        label={`All except ${dropped.length}`}
        count={dropped.length}
        dialogLabel={`${title} taken`}
        icon={false}
        mono={false}
        groups={[{ items: dropped }]}
        className="[&>button]:text-sm [&>button]:text-(--mws-charcoal)"
      />
    );
  }
  return <NameList names={kept} noun={noun} title={`${title} left`} />;
}

// What a broad group still holds once narrower groups took their share.
export function RemainingScope({ group, narrower }) {
  if (narrower.length === 0) return null;
  const chips = groupScopeChips(group);
  const lefts = [group.remaining?.units, group.remaining?.job_positions, group.remaining?.job_levels];
  return (
    <div className="space-y-3 rounded-xl bg-(--mws-soft) px-4 py-3">
      <p className="font-display text-sm font-bold text-(--mws-charcoal)">After Narrower Groups</p>
      <dl aria-label="What is left" className="flex flex-wrap gap-x-6 gap-y-1">
        {chips.map((chip, index) => (
          <div key={chip.label} className="min-w-0 max-w-56">
            <dt className={labelClass}>{chip.label}</dt>
            <dd>
              <LeftValue left={lefts[index]} scopeNames={chip.names} noun={chip.noun} title={chip.label} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <p className={labelClass}>Taken by narrower groups</p>
        <ul className="space-y-2">
          {narrower.map((child) => (
            <li key={child.id} className="flex flex-wrap items-start gap-x-6 gap-y-1">
              <span className="w-28 shrink-0 font-display text-sm font-bold text-(--mws-burgundy)">
                {child.default_role_key}
              </span>
              <ScopeGrid group={child} label={`Scope of ${child.default_role_key} group`} />
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
          <RolePill
            roleKey={group.default_role_key}
            permissions={group.permissions}
          />
        </div>
      </div>
      <GroupFacts group={group} />
      {hasNarrower ? (
        <p className="text-xs text-(--mws-muted)">
          People in narrower groups are not listed here. Add their exceptions to
          that group.
        </p>
      ) : null}
    </div>
  );
}
