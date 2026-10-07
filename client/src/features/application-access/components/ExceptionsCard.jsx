import { ChevronDown, UserPlus, UserRound } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { ExceptionsPanel } from "./ExceptionsPanel.jsx";

// The exceptions of one group as a card of their own, sitting under that group.
export function ExceptionsCard({ group, applicationId, roles, onAdd }) {
  const [open, setOpen] = useState(false);
  const total = group.exception_count;
  const blockedCount = group.blocked_count > 0 ? group.blocked_count : 0;
  const cannotAdd = !group.is_active || group.audience === "STUDENTS";

  return (
    <section
      aria-label={`Exceptions of ${group.default_role_key} group`}
      className="ml-6 rounded-2xl border border-(--mws-line) border-l-4 border-l-(--mws-line) bg-white"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            disabled={total === 0}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full cursor-pointer items-center gap-3 text-left disabled:cursor-default"
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`shrink-0 text-(--mws-muted) transition-transform ${open ? "" : "-rotate-90"} ${total === 0 ? "opacity-30" : ""}`}
            />
            <span className="flex items-center gap-2 font-display text-sm font-bold text-(--mws-charcoal)">
              <span className="text-(--mws-muted)">
                <UserRound size={16} aria-hidden="true" />
              </span>
              Exceptions
            </span>
            <span className="flex items-center gap-2 text-sm font-normal text-(--mws-muted)">
              {total === 0 ? "None" : total}
              {blockedCount > 0 ? <StatusBadge tone="red">{blockedCount} Blocked</StatusBadge> : null}
            </span>
          </button>
        </h3>
        <button
          type="button"
          aria-label={`Add Exception to ${group.default_role_key} Group`}
          disabled={cannotAdd}
          title={
            group.audience === "STUDENTS"
              ? "Exceptions are for employees"
              : !group.is_active
                ? "Turn the group on first"
                : "Add Exception"
          }
          onClick={onAdd}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) transition-colors hover:bg-(--mws-soft) hover:text-(--mws-burgundy) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-(--mws-muted)"
        >
          <UserPlus size={16} />
        </button>
      </div>
      {open && total > 0 ? (
        <div className="border-t border-(--mws-line) px-4 py-3">
          <ExceptionsPanel
            applicationId={applicationId}
            groupId={group.id}
            groupRole={group.default_role_key}
            roles={roles}
            canChange
            total={total}
            emptyText=""
          />
        </div>
      ) : null}
    </section>
  );
}
