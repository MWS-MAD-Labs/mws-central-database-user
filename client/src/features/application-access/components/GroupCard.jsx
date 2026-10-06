import { ChevronDown, UserPlus } from "lucide-react";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { groupScopeSummary, groupShortTitle, groupTitle } from "../utils/groupSummary.js";
import { ExceptionsPanel } from "./ExceptionsPanel.jsx";
import { AudienceIcon, GroupFacts, RolePill, ScopeGrid } from "./GroupSummary.jsx";

// One group as a single line. Open it for the scope, the facts and its exceptions.
export function GroupCard({
  group,
  open,
  onToggle,
  applicationId,
  roles,
  parentTitle,
  childCount,
  onEdit,
  onSwitch,
  onDelete,
  onAddException,
}) {
  const blockedBy =
    group.exception_count + group.blocked_count > 0
      ? `Remove its ${group.exception_count + group.blocked_count} exception(s) first`
      : childCount > 0
        ? "Remove the groups inside it first"
        : null;

  return (
    <section
      className={`min-w-0 rounded-2xl border border-(--mws-line) border-l-4 bg-white ${
        group.is_active ? "border-l-(--mws-burgundy)" : "border-l-(--mws-line)"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-left"
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`shrink-0 text-(--mws-muted) transition-transform ${open ? "" : "-rotate-90"}`}
            />
            <span className="flex items-center gap-2 font-display text-base font-bold text-(--mws-charcoal)">
              <span className="text-(--mws-burgundy)">
                <AudienceIcon audience={group.audience} />
              </span>
              {groupShortTitle(group)}
              {group.is_active ? null : (
                <span className="text-xs font-semibold text-(--mws-muted)">Inactive</span>
              )}
            </span>
            <span className="min-w-0 truncate text-sm font-normal text-(--mws-muted)">{groupScopeSummary(group)}</span>
            <span className="ml-auto flex items-center gap-4 text-sm font-normal">
              <span className="font-display font-bold text-(--mws-burgundy)">{group.default_role_key}</span>
              <span className="text-(--mws-muted)">{group.covered_count ?? 0} covered</span>
              <span className="text-(--mws-muted)">
                {group.exception_count} exception{group.exception_count === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        </h2>
        <ActionsMenu label={`Actions for group ${groupTitle(group)}, ${groupScopeSummary(group)}`}>
          {(closeMenu) => (
            <>
              <ActionsMenuItem
                onClick={() => {
                  closeMenu();
                  onEdit();
                }}
              >
                Edit
              </ActionsMenuItem>
              <ActionsMenuItem
                onClick={() => {
                  closeMenu();
                  onSwitch();
                }}
              >
                {group.is_active ? "Turn off" : "Turn on"}
              </ActionsMenuItem>
              <ActionsMenuItem
                tone="danger"
                disabled={Boolean(blockedBy)}
                title={blockedBy ?? undefined}
                onClick={() => {
                  closeMenu();
                  onDelete();
                }}
              >
                Delete
              </ActionsMenuItem>
            </>
          )}
        </ActionsMenu>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-(--mws-line) px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <ScopeGrid group={group} />
            <RolePill roleKey={group.default_role_key} permissions={group.permissions} />
          </div>
          <GroupFacts group={group} parentTitle={parentTitle} />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">Exceptions</h3>
              <button
                type="button"
                aria-label="Add exception"
                disabled={!group.is_active || group.audience === "STUDENTS"}
                title={
                  group.audience === "STUDENTS"
                    ? "Exceptions are for employees"
                    : !group.is_active
                      ? "Turn the group on first"
                      : "Add exception"
                }
                onClick={onAddException}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) transition-colors hover:bg-(--mws-soft) hover:text-(--mws-burgundy) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-(--mws-muted)"
              >
                <UserPlus size={16} />
              </button>
            </div>
            <ExceptionsPanel
              applicationId={applicationId}
              groupId={group.id}
              roles={roles}
              canChange
              total={group.exception_count}
              emptyText={`No exceptions. Everyone this group covers gets ${group.default_role_key}.`}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
