import { Eye, RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { HintsPopover } from "../../../components/ui/HintsPopover.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import {
  formatStatus,
  getStudentFlagBadges,
  statusTone,
} from "../../../lib/format.js";
import { terminalStudentStatuses } from "../api/studentsApi.js";

export function StudentsTable({
  students,
  yearsById,
  sortBy,
  sortOrder,
  onSort,
  isLoading,
  isTrash,
  canRestore,
  restoringId,
  onRestore,
  canSelect,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  allSelected,
}) {
  const colSpan = canSelect ? 8 : 7;

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          <tr>
            {canSelect ? (
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Select All Students"
                  onChange={onToggleAll}
                  className="size-4 rounded border-(--mws-line) text-(--mws-burgundy) accent-(--mws-burgundy) focus:ring-(--mws-burgundy)"
                />
              </th>
            ) : null}
            <th className="px-4 py-3">
              <SortableHeader
                label="Name"
                column="full_name"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="NIS"
                column="nis"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="Grade"
                column="grade"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">Class</th>
            <th className="px-4 py-3">
              <SortableHeader
                label="Join Year"
                column="join_year"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="Status"
                column="status"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td
                className="px-4 py-10 text-center text-(--mws-muted)"
                colSpan={colSpan}
              >
                Preparing student records...
              </td>
            </tr>
          ) : students.length === 0 ? (
            <tr>
              <td
                className="px-4 py-10 text-center text-(--mws-muted)"
                colSpan={colSpan}
              >
                No students are ready to review.
              </td>
            </tr>
          ) : (
            students.map((student) => (
              <tr
                key={student.id}
                className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
              >
                {canSelect ? (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds?.has(student.id) || false}
                      aria-label={`Select ${student.identity.full_name}`}
                      onChange={() => onToggleSelected?.(student.id)}
                      className="size-4 rounded border-(--mws-line) text-(--mws-burgundy) accent-(--mws-burgundy) focus:ring-(--mws-burgundy)"
                    />
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  {(() => {
                    const flagBadges = getStudentFlagBadges(student);
                    return (
                      <div className="flex max-w-72 items-center gap-1.5">
                        <p className="truncate font-display font-bold text-(--mws-charcoal)">{student.identity.full_name}</p>
                        <HintsPopover badges={flagBadges} />
                      </div>
                    );
                  })()}
                  <p className="max-w-72 truncate text-xs text-(--mws-muted)">
                    {student.identity.email}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-(--mws-charcoal)">
                    {student.academic.nis || (
                      <span className="font-normal text-(--mws-muted)">
                        No NIS yet
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-(--mws-muted)">
                    {student.academic.nisn || "-"}
                  </p>
                </td>
                <td className="px-4 py-3">{student.academic.current_grade}</td>
                <td className="px-4 py-3">
                  {student.academic.current_class_id ? (
                    <Link
                      className="font-medium text-(--mws-burgundy) underline underline-offset-2"
                      to={`/academic/classes/${student.academic.current_class_id}`}
                    >
                      {student.academic.current_class}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3">
                  {yearsById[student.academic.join_academic_year_id] || "-"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge tone={statusTone(student.status)}>
                    {formatStatus(student.status)}
                  </StatusBadge>
                  {terminalStudentStatuses.includes(student.status) &&
                  !student.academic.has_class_history ? (
                    <StatusBadge
                      tone="amber"
                      className="mt-1 flex w-fit"
                      title="No class enrollment was ever recorded for this student. Review their data."
                    >
                      No class history
                    </StatusBadge>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right">
                  {isTrash ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!canRestore || restoringId === student.id}
                      onClick={() => onRestore?.(student.id)}
                      size="icon" aria-label="Restore" title="Restore"
                    >
                      <RotateCcw size={15} />
                    </Button>
                  ) : (
                    <Button asChild variant="ghost" size="icon" aria-label="View" title="View">
                      <Link to={`/students/${student.id}`}><Eye size={15} /></Link>
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
